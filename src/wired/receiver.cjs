'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {Duplex} = require('node:stream');
const {checkUsb, installScope} = require('./usb-sockets.cjs');
const {openAppleService} = require('./apple-service.cjs');
const {wiredIdentity, wiredStartSession} = require('./session-messages.cjs');
const engine = path.resolve(__dirname, '../../build/engine');
const {CpStack} = require(path.join(engine, 'protocol/cpStack'));
const {loadOrCreateIdentity, accessoryDeviceId} = require(path.join(engine, 'protocol/identity'));
const {LocalSigner} = require(path.join(engine, 'auth'));
const {Accessory,IapLink,fields,csm,param,u16}=require(path.join(engine,'iap'));
const {VideoFrameGate}=require(path.join(engine,'videoFrameGate'));
const {FrameRateFallback}=require(path.join(engine,'frameRateFallback'));
const {NowPlaying}=require(path.join(engine,'nowPlaying'));
const {setIapRelayFactory}=require(path.join(engine,'relay'));
const {closeMedia,micPacket}=require(path.join(engine,'media'));

const send = process.send?.bind(process);
const status = (text, detail='') => send?.({type:'status',status:text,detail});
const lifetime = new AbortController();
const links = new Set(), sessions = new Set();
let settings, active, bridge, listener, discovery, gate, playing, accessory, activeLink;
let deadline, metrics, fallback, videoRecovery, stopping=false, receivedFrames=0, receivedVideo=false;

function stop() {
  if(stopping)return;
  stopping=true;
  clearTimeout(deadline);
  clearTimeout(videoRecovery);
  fallback?.cancel();
  clearInterval(metrics);
  lifetime.abort();
  discovery?.stop();
  gate?.close();
  listener?.close();
  playing?.close();
  setIapRelayFactory(undefined);
  for(const stack of sessions)stack.stop();
  for(const link of links)link.close();
  bridge?.child.kill();
  closeMedia();
  if(process.connected)send({type:'stopped'});
  setTimeout(()=>process.exit(0),100).unref();
}

async function begin(configured) {
  if(settings || stopping)return;
  settings=configured;
  const usb=settings.wiredUsb;
  const started=Date.now();
  const scope=await checkUsb(usb,lifetime.signal);
  lifetime.signal.throwIfAborted();
  send?.({type:'diagnostic',status:'连接诊断：已复核USB接收网卡',detail:JSON.stringify({elapsedMs:Date.now()-started})});
  console.log=console.warn=console.error=()=>{};
  const serviceStarted=Date.now();
  bridge=await openAppleService(usb.deviceId,lifetime.signal);
  if(stopping){bridge.child.kill();return;}
  send?.({type:'diagnostic',status:'连接诊断：Apple有线控制服务已就绪',detail:JSON.stringify({elapsedMs:Date.now()-serviceStarted})});
  const {acceptVerifiedPeer,acceptAuthenticatedPeer,createControlServer}=installScope(scope);
  const identity=loadOrCreateIdentity();
  const signer=new LocalSigner(path.join(process.env.WINPLAY_DATA,'authentication'));
  const identityConfig={serial:'WINPLAY-'+identity.pairingId,btMac:'',ssid:'',password:''};
  const config={
    networkScope:scope.index,deviceName:'WinPlay',deviceId:accessoryDeviceId(identity.pubRaw),btMac:usb.mac,
    sourceVersion:'950.7.1',hevc:false,h264:true,port:17000,entertainmentSampleRate:48000,mfi:signer,
    audioVolume:()=>settings.mediaVolume,oemLabel:'WinPlay',rightHandDrive:false,
    icons:[256,512].map(size=>({widthPixels:size,heightPixels:size,data:fs.readFileSync(path.join(process.env.WINPLAY_RESOURCES,'icons','winplay-'+size+'.png'))})),
    main:{widthPixels:settings.width,heightPixels:settings.height,fps:settings.fps,primaryInputDevice:1,
      viewArea:{top:0,bottom:0,left:0,right:0},safeArea:{top:0,bottom:0,left:0,right:0},safeAreaDrawOutside:true}
  };
  gate=new VideoFrameGate({send:frame=>send({type:'video-frame',...frame}),
    pause:on=>active?.setMainVideoBackpressure(on),requestKey:()=>active?.forceMainKeyframe()});
  playing=new NowPlaying((state,artChanged)=>send({type:'now-playing',state,artChanged}),bytes=>activeLink?.send(bytes,12));
  let listening=false, available=false, handoffSent=false, primaryLink;
  const startSession=()=>{
    if(!listening||!available||!accessory?.authenticated||handoffSent||stopping)return;
    const message=wiredStartSession({address:scope.local,port:config.port,mac:usb.mac,publicKey:identity.pkHex});
    primaryLink.send(message);
    handoffSent=true;
    fallback?.negotiationStarted();
    status('已发送CarPlay参数，等待iPhone网络连接');
  };
  function setAttempt(fps){
    config.main.fps=fps;
    fallback=new FrameRateFallback(fps,next=>{
      if(stopping||receivedVideo)return;
      if(!links.has(primaryLink)||!accessory?.authenticated){
        status('帧率回退失败，请重新启动接收','有线交接通道已关闭，请选择60fps后重新启动接收。');
        stop();
        return;
      }
      const previous=[...sessions];
      sessions.clear();
      active=undefined;
      for(const stack of previous)stack.stop();
      handoffSent=false;
      setAttempt(next);
      send({type:'requested-fps',requested:settings.fps,attempt:next});
      clearTimeout(deadline);
      deadline=setTimeout(()=>{status('有线CarPlay等待视频超时');stop();},45000);
      startSession();
    });
  }
  setAttempt(settings.fps);
  function wireIap(stream, primary) {
    const link=new IapLink(stream,{initiate:true,zeroAck:true});
    if(primary)primaryLink=link;
    links.add(link);
    const facade=new EventEmitter();
    facade.send=bytes=>link.send(bytes);
    facade.close=()=>link.close();
    const handler=new Accessory(facade,signer,identityConfig,{bootstrap:false});
    handler.on('status',()=>{
      if(!handler.authenticated)return;
      activeLink=link;
      if(primary){link.send(csm(0xae03,[param(0,u16(500)),param(1,Buffer.from([1]))]));startSession();}
    });
    handler.on('now-playing',value=>playing?.apply(value));
    link.on('file',value=>playing?.file(value));
    handler.on('failed',()=>{if(primary&&!handoffSent&&!stopping){status('iPhone有线CarPlay认证失败');stop();}});
    link.on('transport-closed',()=>{
      links.delete(link);handler.close();
      if(primary&&!handoffSent&&!stopping){status('iPhone有线控制服务提前断开');stop();}
    });
    link.on('csm',(id,parameters)=>{
      if(id===0x1d00){link.send(wiredIdentity(identityConfig,usb.usbMuxInterface));return;}
      if(id===0x4300){
        if(primary){const value=fields(parameters.get(0)||Buffer.alloc(0)).get(0);available=value?.length===1&&value[0]===1;startSession();}
        return;
      }
      if(![0x5702,0x4e0d,0x4e0e].includes(id))facade.emit('csm',id,parameters);
    });
    return handler;
  }
  accessory=wireIap(bridge.stream,true);
  setIapRelayFactory(()=>{
    let protocol;
    const relay=new Duplex({read(){},write(bytes,_encoding,cb){protocol.push(Buffer.from(bytes));cb();}});
    protocol=new Duplex({read(){},write(bytes,_encoding,cb){relay.push(Buffer.from(bytes));cb();}});
    relay.once('close',()=>protocol.destroy());
    wireIap(protocol,false);
    return relay;
  });

  listener=createControlServer(socket=>{
    if (active || sessions.size>=4) {socket.destroy();return;}
    const stack=new CpStack({...config,main:{...config.main}});
    sessions.add(stack);
    const handle=stack._handle.bind(stack);
    stack._handle=async(request,session)=>{
      if ((!handoffSent || !session.pairVerify.verified) &&
        (['SETUP','RECORD','SET_PARAMETER'].includes(request.method)||request.path.endsWith('/command')))return {status:403};
      return handle(request,session);
    };
    stack.deviceFilter=id=>{
      const normalized=value=>String(value).replace(/[:-]/g,'').toUpperCase();
      return typeof id==='string'&&/^(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/i.test(id)&&
        normalized(id)===normalized(bridge.phoneDeviceId)&&acceptAuthenticatedPeer(socket.remoteAddress);
    };
    let videoConfig;
    const configure = data=>send({type:'video-config',generation:gate.configure(data),data,width:settings.width,height:settings.height});
    stack.setAudioActive(false);
    stack.on('session-active',()=>{
      if(!stack.hasVerifiedSession||(active&&active!==stack)){socket.destroy();return;}
      active=stack;
      for(const other of sessions)if(other!==stack)other.stop();
      if(videoConfig)configure(videoConfig);
      stack.setAudioActive(true);
    });
    stack.on('video-config',data=>{videoConfig=data;if(active===stack)configure(data);});
    stack.on('video-frame',data=>{
      if(active!==stack||!stack.hasVerifiedSession)return;
      receivedFrames++;
      clearTimeout(videoRecovery);
      if(!receivedVideo){receivedVideo=true;clearTimeout(deadline);fallback.videoStarted();status('正在接收CarPlay视频');send({type:'connected'});}
      gate.push(data,Number(process.hrtime.bigint()/1000n));
    });
    stack.on('error',()=>{if(active===stack){status('有线CarPlay会话异常');stop();}else socket.destroy();});
    stack.on('video-ended',()=>{
      if(!receivedVideo||active!==stack)return;
      gate.recover('reconnect');
      clearTimeout(videoRecovery);
      videoRecovery=setTimeout(()=>{status('视频通道恢复超时');stop();},8000);
    });
    const ended=()=>{
      sessions.delete(stack);
      if(active!==stack)return;
      active=undefined;
      if(!receivedVideo&&config.main.fps>60){fallback.failed();return;}
      stop();
    };
    stack.on('session-ended',ended);
    stack.on('connection-closed',ended);
    stack.on('host-ui-requested',()=>{if(active===stack)send({type:'show-settings'});});
    stack.attachSocket(socket);
  });
  listener.on('error',()=>{status('无法在iPhone USB网卡上启动接收');stop();});
  listener.listen({host:scope.address,port:config.port},()=>{
    listening=true;
    send({type:'started',requested:settings.fps});
    startSession();
    try{
      discovery=require('./usb-discovery.cjs').startDiscovery(scope,
        {deviceId:config.deviceId,pi:identity.pairingId,pk:identity.pkHex,btMac:usb.mac},
        bridge.phoneDeviceId,()=>!stopping&&!active,()=>{},acceptVerifiedPeer);
    }catch {send({type:'diagnostic',status:'连接诊断：USB网络发现未启动'});}
  });
  deadline=setTimeout(()=>{status('有线CarPlay等待视频超时');stop();},45000);
  metrics=setInterval(()=>{
    gate.tick();
    send({type:'metrics',requested:settings.fps,attempt:config.main.fps,receivedFps:receivedFrames});
    receivedFrames=0;
    send({type:'position',positionMs:playing.position()});
  },1000);
}

process.on('message',msg=>{
  if(msg?.command==='start')begin(msg.settings).catch(error=>{
    if(!stopping)status('有线CarPlay启动失败',/[\u4e00-\u9fff]/.test(error.message)?error.message:'');
    stop();
  });
  if(msg?.command==='stop')stop();
  if(msg?.command==='video-ack')gate?.ack(msg);
  if(msg?.command==='video-recover')gate?.recover(msg.reason==='ipc-overflow'?'ipc-overflow':'transport-overflow');
  if(msg?.command==='request-keyframe')active?.forceMainKeyframe();
  if(msg?.command==='touch'&&active&&Number.isFinite(msg.x)&&Number.isFinite(msg.y)){
    const clamp=value=>Math.min(1,Math.max(0,value));
    active.sendTouches([{x:clamp(msg.x),y:clamp(msg.y),down:!!msg.down,id:0}]);
  }
  if(msg?.command==='media'&&Number.isInteger(msg.index)&&msg.index>=1&&msg.index<=5)active?.sendMedia(msg.index);
  if(msg?.command==='seek'&&playing&&Number.isFinite(msg.ms)&&playing.seek(msg.ms))accessory?.seek(Math.round(playing.state.positionMs));
  if(msg?.command==='mic'&&active&&Buffer.isBuffer(msg.data))micPacket(msg.id,msg.data,msg.samples);
  if(msg?.command==='audio'&&settings){
    settings.mediaVolume=msg.mediaVolume;
    settings.callVolume=msg.callVolume;
    for(const stack of sessions){
      stack.setStreamVolume(3,settings.mediaVolume,0);
      stack.setStreamVolume(4,settings.mediaVolume,0);
      stack.setStreamVolume(2,settings.callVolume,0);
    }
  }
});
process.on('disconnect',stop);
process.on('uncaughtException',()=>{
  if(!stopping)status('有线CarPlay接收进程异常');
  stop();
});
