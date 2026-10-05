import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import { Discovery } from './discovery'
import { CpStack } from './protocol/cpStack'
import { loadOrCreateIdentity, accessoryDeviceId } from './protocol/identity'
import { LocalSigner, validateAuthentication } from './auth'
import { dataDir, writeProtected } from './storage'
import { FrameRateFallback } from './frameRateFallback'
import { Accessory,IapLink } from './iap'
import { NowPlaying } from './nowPlaying'
import { setIapRelayFactory } from './relay'
import { closeMedia,micPacket,reportAudioTransport } from './media'
import { accessPointIdentifier, receiverNetwork } from './networkMode'
import { HandoffRecovery } from './handoffRecovery'
import { VideoFrameGate } from './videoFrameGate'
const send=(msg:any)=>{if(process.connected)process.send?.(msg)}
// Upstream raw diagnostics contain phone identifiers and network addresses.
// The release exposes only our explicit status messages and numeric metrics.
console.log=()=>{};console.warn=()=>{};console.error=()=>{}
let server:net.Server|undefined,bonjour:Discovery|undefined,accessory:Accessory|undefined,bluetooth:ReturnType<typeof spawn>|undefined,active:CpStack|undefined,guard:FrameRateFallback|undefined
const sessions=new Set<CpStack>();let stopRequested=false,hadVideo=false,receivedFrames=0,currentFps=60,settings:any,ticker:NodeJS.Timeout|undefined,videoDeadline:NodeJS.Timeout|undefined,controlConnections=0
let videoGate:VideoFrameGate|undefined,videoOwner:CpStack|undefined
let videoRecovery:NodeJS.Timeout|undefined,networkDeadline:NodeJS.Timeout|undefined,handoffRecovery:HandoffRecovery|undefined
let playing:NowPlaying|undefined
let bluetoothReleased=false
const handshakeStatuses=new Set(['连接iPhone蓝牙RFCOMM服务','iPhone已接受配件识别','MFi认证已通过，等待CarPlay请求','已发送CarPlay参数，等待iPhone网络连接','CarPlay会话已建立，等待视频','已收到视频配置'])
const status=(s:string,detail='')=>send({type:hadVideo&&handshakeStatuses.has(s)?'diagnostic':'status',status:s,detail})
let attemptStarted=0,totalVideoFrames=0,btReceivedBytes=0,btSentBytes=0,negotiations=0,lastStage='初始化'
const errorInfo=(error:any)=>({code:error?.code,errno:error?.errno,syscall:error?.syscall,message:error instanceof Error?error.message:String(error||'')})
const diagnostic=(stage:string,values:object={})=>{lastStage=stage;send({type:'diagnostic',status:'连接诊断：'+stage,detail:JSON.stringify({elapsedMs:Date.now()-attemptStarted,...values})})}
function nativeList(){return new Promise<any>((resolve,reject)=>{const p=spawn(process.env.WINPLAY_NATIVE!,['list'],{windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',()=>reject(new Error('蓝牙桥接程序无法运行')));p.on('close',code=>{try{if(code!==0)throw new Error(err);resolve(JSON.parse(out))}catch(e){reject(e)}})})}
function network(cfg:any){const nics=os.networkInterfaces(),selected=nics[cfg.networkInterface];if(!selected)throw new Error('请选择接收端网络接口：移动热点虚拟接口或现有局域网Wi-Fi接口')
 return receiverNetwork(selected)
}
async function begin(cfg:any){attemptStarted=Date.now();settings=cfg;currentFps=cfg.fps;stopRequested=false;bluetoothReleased=false;controlConnections=0;diagnostic('接收进程启动',{mode:cfg.wirelessMode,requestedFps:cfg.fps,width:cfg.width,height:cfg.height});const signer=new LocalSigner(path.join(dataDir,'authentication'));const identity=loadOrCreateIdentity();const nic=network(cfg);diagnostic('网络参数选定',{family:nic.family,alternateFamily:nic.alternateFamily||'none',ipv6ScopeValid:!!nic.scope,channel:cfg.channel,accessPointProvided:!!cfg.accessPointMac});const bt=await nativeList();diagnostic('蓝牙枚举完成',{pairedDevices:bt.devices.length,selectedPresent:bt.devices.some((d:any)=>d.address===cfg.targetBluetooth)})
 videoGate=new VideoFrameGate({send:frame=>send({type:'video-frame',...frame}),pause:paused=>(active||videoOwner)?.setMainVideoBackpressure(paused),requestKey:()=>(active||videoOwner)?.forceMainKeyframe()})
 if(stopRequested)return
 if(!bt.devices.some((d:any)=>d.address===cfg.targetBluetooth))throw new Error('请选择已在Windows中配对的iPhone')
 const networkWaitDetail=cfg.wirelessMode==='lan'?'蓝牙认证已通过，但尚未收到iPhone的网络连接。请确认两端使用可互访的同一网络，允许WinPlay安装目录中resources\\node\\node.exe通过Windows防火墙，并检查路由器的访客网络或客户端隔离。可在iPhone上重新加入Wi-Fi，或改用本机移动热点。':'请确认iPhone已加入Windows移动热点，并检查当前网络接口和防火墙。'
 const armVideoDeadline=()=>{if(videoDeadline)clearTimeout(videoDeadline);videoDeadline=setTimeout(()=>{if(!hadVideo&&!stopRequested){status(controlConnections?'CarPlay视频连接超时':'iPhone网络连接超时',controlConnections?'请检查当前无线模式的网络接口和防火墙':networkWaitDetail);shutdown()}},45000)}
 const deviceId=accessoryDeviceId(identity.pubRaw)
 const icons=[256,512].map(size=>({widthPixels:size,heightPixels:size,data:fs.readFileSync(path.join(process.env.WINPLAY_RESOURCES!,'icons',`winplay-${size}.png`))}))
 const config={networkScope:nic.scope,deviceName:'WinPlay',deviceId,btMac:bt.adapter,sourceVersion:'950.7.1',hevc:false,h264:true,main:{widthPixels:cfg.width,heightPixels:cfg.height,fps:cfg.fps,primaryInputDevice:1,viewArea:{top:0,bottom:0,left:0,right:0},safeArea:{top:0,bottom:0,left:0,right:0},safeAreaDrawOutside:true},port:17000,entertainmentSampleRate:48000 as const,audioVolume:(type:number)=>type===2?settings.callVolume:type===1?1:settings.mediaVolume,audioDevice:()=>settings.outputDevice||undefined,audioInputDevice:()=>settings.inputDevice||undefined,mfi:signer,oemLabel:'WinPlay',icons,rightHandDrive:false}
 const applyGuard=(fps:number)=>{config.main.fps=fps;currentFps=fps;guard=new FrameRateFallback(fps,next=>{if(stopRequested||hadVideo)return;for(const stack of sessions)stack.stop();sessions.clear();active=undefined;applyGuard(next);guard?.negotiationStarted();if(next<=60)armVideoDeadline();send({type:'requested-fps',requested:settings.fps,attempt:next});accessory?.startCarPlay().catch(error=>{if(!stopRequested){diagnostic('帧率回退参数发送失败',errorInfo(error));status('帧率回退失败，请重新启动接收');shutdown()}})})};applyGuard(cfg.fps)
 server=net.createServer(socket=>{if(stopRequested||sessions.size>=8){socket.destroy();return}controlConnections++;handoffRecovery?.networkConnected();if(networkDeadline){clearTimeout(networkDeadline);networkDeadline=undefined}if(controlConnections===1&&currentFps<=60)armVideoDeadline();status('网络控制连接已到达','连接数：'+controlConnections);const stack=new CpStack({...config,main:{...config.main}});sessions.add(stack);stack.setAudioActive(true)
  const connectionId=controlConnections;diagnostic('网络控制连接到达',{connection:connectionId,peerFamily:socket.remoteFamily,localPort:socket.localPort,peerPort:socket.remotePort});socket.on('error',error=>diagnostic('网络控制套接字错误',{connection:connectionId,...errorInfo(error)}));socket.on('close',hadError=>diagnostic('网络控制套接字关闭',{connection:connectionId,hadError,videoReceived:hadVideo}));
  stack.on('session-active',()=>{if(active&&active!==stack){diagnostic('拒绝额外会话',{connection:connectionId});stack.stop();return}active=stack;diagnostic('CarPlay会话建立',{connection:connectionId});status('CarPlay会话已建立，等待视频');guard?.negotiationStarted()})
  stack.on('video-config',(data:Buffer)=>{if(stopRequested||active&&active!==stack)return;videoOwner=stack;const generation=videoGate?.configure(data);diagnostic('视频配置到达',{connection:connectionId,generation,configBytes:data.length,requestedWidth:cfg.width,requestedHeight:cfg.height});status('已收到视频配置');send({type:'video-config',data,generation,width:cfg.width,height:cfg.height})})
  stack.on('video-frame',(data:Buffer)=>{if(stopRequested||active&&active!==stack)return;videoOwner=stack;receivedFrames++;totalVideoFrames++;if(videoRecovery){clearTimeout(videoRecovery);videoRecovery=undefined;diagnostic('视频通道恢复',{connection:connectionId});status('正在接收CarPlay视频')}if(!hadVideo){hadVideo=true;diagnostic('视频首帧到达',{connection:connectionId,frameBytes:data.length});guard?.videoStarted();if(videoDeadline)clearTimeout(videoDeadline);status('正在接收CarPlay视频');send({type:'connected'})}videoGate?.push(data,Number(process.hrtime.bigint()/1000n))})
  stack.on('video-ended',()=>{if(hadVideo&&!stopRequested&&active===stack){videoGate?.recover('reconnect');if(videoRecovery)clearTimeout(videoRecovery);status('视频通道正在重新连接');videoRecovery=setTimeout(()=>{status('视频通道恢复超时');shutdown()},8000)}})
  stack.on('session-ended',()=>{
   diagnostic('CarPlay会话结束',{connection:connectionId,wasActive:active===stack,videoReceived:hadVideo});
   sessions.delete(stack);const wasActive=active===stack;if(wasActive)active=undefined;stack.stop()
   if(stopRequested||active&&!wasActive)return
   if(hadVideo){if(wasActive)shutdown();return}
   if(wasActive&&currentFps<=60){status('iPhone结束连接，未收到视频，请重新启动接收');shutdown()}
   else guard?.failed()
  })
  stack.on('host-ui-requested',()=>send({type:'show-settings'}));stack.on('error',(error:any)=>{diagnostic('CarPlay协议错误',{connection:connectionId,...errorInfo(error)});status('CarPlay协议错误，请重新启动接收')})
  stack.on('protocol-state',(stage:string,detail:string)=>status(stage,detail));stack.deviceFilter=id=>id.replace(/[^a-f0-9]/gi,'').toLowerCase()===cfg.targetBluetooth.replace(/[^a-f0-9]/gi,'').toLowerCase();
  stack.attachSocket(socket)
 });server.on('error',error=>{if(!stopRequested){diagnostic('接收端监听失败',errorInfo(error));status('TCP17000接收端口不可用，请检查端口占用');shutdown()}});await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen({port:17000,host:'::',ipv6Only:false},resolve)});if(stopRequested)return;status('网络接收端已就绪','TCP17000；IPv4/IPv6双栈监听；接入点标识：'+(cfg.wirelessMode==='lan'&&cfg.accessPointMac?'已提供':'使用接口标识'))
 bonjour=new Discovery(cfg.networkInterface,{deviceId,pk:identity.pkHex,pi:identity.pairingId,btMac:bt.adapter},cfg.targetBluetooth,()=>!!accessory?.authenticated,s=>status(s))
 let stream:Duplex
 status('连接iPhone蓝牙RFCOMM服务');bluetooth=spawn(process.env.WINPLAY_NATIVE!,['bluetooth',cfg.targetBluetooth],{windowsHide:true});let bluetoothError='';bluetooth.stderr!.on('data',b=>bluetoothError=(bluetoothError+b).slice(-512));bluetooth.on('error',()=>{status('蓝牙桥接启动失败');shutdown()});bluetooth.on('exit',code=>{if(stopRequested||bluetoothReleased)return;if(!hadVideo&&code!==0){status('蓝牙RFCOMM连接失败',bluetoothError);shutdown()}})
  let firstBluetoothData=true;stream=new Duplex({read(){},write(chunk,_encoding,cb){btSentBytes+=chunk.length;bluetooth!.stdin!.write(chunk,cb)}});bluetooth.stdout!.on('data',b=>{btReceivedBytes+=b.length;if(firstBluetoothData){firstBluetoothData=false;diagnostic('蓝牙首批数据到达',{bytes:b.length})}stream.push(b)});bluetooth.stdout!.on('end',()=>{diagnostic('蓝牙接收通道关闭',{btReceivedBytes,btSentBytes,released:bluetoothReleased});stream.push(null)});stream.on('close',()=>bluetooth?.kill());bluetooth.on('exit',(code,signal)=>diagnostic('蓝牙桥接退出',{exitCode:code,signal,released:bluetoothReleased,videoReceived:hadVideo,btReceivedBytes,btSentBytes}));
 const handoff={ssid:cfg.ssid,password:cfg.password,channel:cfg.channel,btMac:bt.adapter,apMac:accessPointIdentifier(cfg,nic.mac),host:nic.host,port:17000,pk:identity.pkHex,serial:'WINPLAY-'+identity.pairingId.toUpperCase()}
 let activeLink:IapLink;const accessories=new Set<Accessory>(),openLinks=new Set<IapLink>()
 status('网络发现：连接参数已准备/'+nic.family)
 handoffRecovery=new HandoffRecovery({alternateHost:nic.alternateHost,onFallback:host=>{
  if(stopRequested||controlConnections||!accessory?.authenticated)return;
  if(!openLinks.has(activeLink)){status('网络发现：蓝牙通道已关闭，保留原网络等待期限');return}
  handoff.host=host;status('正在切换CarPlay连接地址',nic.alternateFamily==='IPv6'?'改用IPv6重试；Windows网络设置保持不变。':'改用IPv4重试；Windows网络设置保持不变。');
  accessory.startCarPlay().catch(()=>{if(!stopRequested&&!controlConnections)status('网络发现：备用连接参数未能发送，保留原网络等待期限')})
 },onWait:cfg.wirelessMode==='lan'?()=>{if(!stopRequested&&!controlConnections)status('仍在等待iPhone网络连接',networkWaitDetail)}:undefined})
 if(controlConnections)handoffRecovery.networkConnected()
 const bindAccessory=(link:IapLink,tunnel=false)=>{const previous=accessory;activeLink=link;openLinks.add(link);const current=new Accessory(link,signer,handoff);accessory=current;accessories.add(current)
  current.on('status',s=>{if(!stopRequested&&accessory===current){status(s);if(tunnel&&current.authenticated){bluetoothReleased=true;previous?.close();bluetooth?.kill()}}});current.on('negotiation',()=>{if(!stopRequested&&accessory===current){
   // The network iAP relay also negotiates after video has started.
   // It must not restart handoff timers or replace an established state.
   negotiations++;diagnostic('iAP参数协商完成',{transport:tunnel?'network':'bluetooth',negotiations,networkConnected:!!controlConnections,videoReceived:hadVideo});if(controlConnections)return;
   guard?.negotiationStarted();handoffRecovery?.negotiationStarted();
   // Address retries and repeated iPhone requests must not extend a failed
   // network attempt indefinitely or disturb an already established session.
   if(!controlConnections&&!networkDeadline)networkDeadline=setTimeout(()=>{if(!controlConnections&&!stopRequested){status('iPhone网络连接超时',networkWaitDetail);shutdown()}},45000);
   if(currentFps<=60&&!videoDeadline)armVideoDeadline();
   status('已发送CarPlay参数，等待iPhone网络连接')
  }});current.on('failed',s=>{if(accessory===current){status(s);shutdown()}})
  link.on('transport-closed',()=>{openLinks.delete(link);if(accessory===current&&(tunnel||!current.authenticated))shutdown()});current.on('now-playing',p=>playing?.apply(p));link.on('file',b=>playing?.file(b));return current
 }
 playing=new NowPlaying((state,artChanged)=>send({type:'now-playing',state,artChanged}),b=>activeLink.send(b,12));bindAccessory(new IapLink(stream))
 setIapRelayFactory(()=>{
  let protocol:Duplex;const relay=new Duplex({read(){},write(b,_enc,cb){protocol.push(Buffer.from(b));cb()}});protocol=new Duplex({read(){},write(b,_enc,cb){relay.push(Buffer.from(b));cb()}});relay.on('close',()=>protocol.destroy());bindAccessory(new IapLink(protocol,{initiate:true,zeroAck:true}),true);return relay
 })
 process.once('exit',()=>{for(const a of accessories)a.close()})
 let videoDiagnosticTick=0
 ticker=setInterval(()=>{videoGate?.tick();send({type:'metrics',requested:settings.fps,attempt:currentFps,receivedFps:receivedFrames});receivedFrames=0;if(++videoDiagnosticTick%10===0)reportAudioTransport();if(videoDiagnosticTick%10===0&&videoGate)send({type:'video-diagnostic',...videoGate.diagnostics()});if(playing)send({type:'position',positionMs:playing.position()})},1000)
 send({type:'started',requested:cfg.fps});status(cfg.wirelessMode==='lan'?'局域网接收已启动，请确认两端在同一Wi-Fi':'本机热点接收已启动，请让iPhone接入Windows移动热点')
}
function shutdown(){if(stopRequested)return;diagnostic('接收结束汇总',{lastStage,controlConnections,negotiations,totalVideoFrames,btReceivedBytes,btSentBytes,videoReceived:hadVideo,authenticated:!!accessory?.authenticated});stopRequested=true;videoGate?.close();videoGate=undefined;videoOwner=undefined;playing?.close();guard?.cancel();handoffRecovery?.cancel();if(networkDeadline)clearTimeout(networkDeadline);if(videoRecovery)clearTimeout(videoRecovery);if(ticker)clearInterval(ticker);if(videoDeadline)clearTimeout(videoDeadline);for(const stack of [...sessions])stack.stop();sessions.clear();accessory?.close();setIapRelayFactory(undefined);bluetooth?.kill();closeMedia();bonjour?.destroy();server?.close();hadVideo=false;send({type:'stopped'});setTimeout(()=>process.exit(0),250).unref()}
process.on('message',async(msg:any)=>{try{
 if(msg.command==='start')await begin(msg.settings)
 if(msg.command==='stop')shutdown()
 if(msg.command==='request-keyframe')(active||videoOwner)?.forceMainKeyframe()
 if(msg.command==='video-ack')videoGate?.ack(msg)
 if(msg.command==='video-recover')videoGate?.recover(msg.reason==='ipc-overflow'?'ipc-overflow':'transport-overflow')
 if(msg.command==='touch'&&active){const {x,y,down}=msg;if(Number.isFinite(x)&&Number.isFinite(y))active.sendTouches([{x:Math.min(1,Math.max(0,x)),y:Math.min(1,Math.max(0,y)),down:!!down,id:0}])}
 if(msg.command==='media'&&Number.isInteger(msg.index)&&msg.index>=1&&msg.index<=5)active?.sendMedia(msg.index)
 if(msg.command==='seek'&&playing&&Number.isFinite(msg.ms)&&playing.seek(msg.ms))accessory?.seek(Math.round(playing.state.positionMs))
 if(msg.command==='audio'){settings.mediaVolume=Math.min(1,Math.max(0,Number(msg.mediaVolume)));settings.callVolume=Math.min(1,Math.max(0,Number(msg.callVolume)));for(const s of sessions){s.setStreamVolume(3,settings.mediaVolume,0);s.setStreamVolume(4,settings.mediaVolume,0);s.setStreamVolume(2,settings.callVolume,0)}}
 if(msg.command==='mic')micPacket(msg.id,Buffer.from(msg.data),msg.samples)
 if(msg.command==='validate-auth'){validateAuthentication(Buffer.from(msg.key),Buffer.from(msg.cert));send({type:'auth-valid'})}
 if(msg.command==='import-auth'){validateAuthentication(Buffer.from(msg.key),Buffer.from(msg.cert));const dir=path.join(dataDir,'authentication');fs.mkdirSync(dir,{recursive:true});writeProtected(path.join(dir,'identity.pk8.dpapi'),Buffer.from(msg.key));writeProtected(path.join(dir,'certificate.p7b.dpapi'),Buffer.from(msg.cert));send({type:'auth-imported'});setTimeout(()=>process.exit(0),100)}
 }catch(e){diagnostic('命令执行失败',{command:msg.command,...errorInfo(e)});status((e as Error).message);shutdown()}})
process.on('disconnect',shutdown);process.on('uncaughtException',(error)=>{diagnostic('接收进程异常',errorInfo(error));status('接收进程异常，请重新启动接收');shutdown()})
