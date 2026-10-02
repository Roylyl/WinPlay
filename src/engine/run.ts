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
import { closeMedia,micPacket } from './media'
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
const status=(s:string,detail='')=>send({type:'status',status:s,detail})
function nativeList(){return new Promise<any>((resolve,reject)=>{const p=spawn(process.env.WINPLAY_NATIVE!,['list'],{windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',()=>reject(new Error('蓝牙桥接程序无法运行')));p.on('close',code=>{try{if(code!==0)throw new Error(err);resolve(JSON.parse(out))}catch(e){reject(e)}})})}
function network(cfg:any){const nics=os.networkInterfaces(),selected=nics[cfg.networkInterface];if(!selected)throw new Error('请选择接收端网络接口：移动热点虚拟接口或现有局域网Wi-Fi接口')
 return receiverNetwork(selected)
}
async function begin(cfg:any){settings=cfg;currentFps=cfg.fps;stopRequested=false;bluetoothReleased=false;controlConnections=0;const signer=new LocalSigner(path.join(dataDir,'authentication'));const identity=loadOrCreateIdentity();const nic=network(cfg);const bt=await nativeList()
 videoGate=new VideoFrameGate({send:frame=>send({type:'video-frame',...frame}),pause:paused=>(active||videoOwner)?.setMainVideoBackpressure(paused),requestKey:()=>(active||videoOwner)?.forceMainKeyframe()})
 if(stopRequested)return
 if(!bt.devices.some((d:any)=>d.address===cfg.targetBluetooth))throw new Error('请选择已在Windows中配对的iPhone')
 const networkWaitDetail=cfg.wirelessMode==='lan'?'若iPhone已连接同一Wi-Fi却仍未建立CarPlay，可在iPhone上断开该Wi-Fi再重新加入，或改用本机移动热点。':'请确认iPhone已加入Windows移动热点，并检查当前网络接口和防火墙。'
 const armVideoDeadline=()=>{if(videoDeadline)clearTimeout(videoDeadline);videoDeadline=setTimeout(()=>{if(!hadVideo&&!stopRequested){status(controlConnections?'CarPlay视频连接超时':'iPhone网络连接超时',controlConnections?'请检查当前无线模式的网络接口和防火墙':networkWaitDetail);shutdown()}},45000)}
 const deviceId=accessoryDeviceId(identity.pubRaw)
 const icons=[256,512].map(size=>({widthPixels:size,heightPixels:size,data:fs.readFileSync(path.join(process.env.WINPLAY_RESOURCES!,'icons',`winplay-${size}.png`))}))
 const config={networkScope:nic.scope,deviceName:'WinPlay',deviceId,btMac:bt.adapter,sourceVersion:'950.7.1',hevc:false,h264:true,main:{widthPixels:cfg.width,heightPixels:cfg.height,fps:cfg.fps,primaryInputDevice:1,viewArea:{top:0,bottom:0,left:0,right:0},safeArea:{top:0,bottom:0,left:0,right:0},safeAreaDrawOutside:true},port:17000,entertainmentSampleRate:48000 as const,audioVolume:(type:number)=>type===2?settings.callVolume:type===1?1:settings.mediaVolume,audioDevice:()=>settings.outputDevice||undefined,audioInputDevice:()=>settings.inputDevice||undefined,mfi:signer,oemLabel:'WinPlay',icons,rightHandDrive:false}
 const applyGuard=(fps:number)=>{config.main.fps=fps;currentFps=fps;guard=new FrameRateFallback(fps,next=>{if(stopRequested||hadVideo)return;for(const stack of sessions)stack.stop();sessions.clear();active=undefined;applyGuard(next);send({type:'requested-fps',requested:settings.fps,attempt:next});accessory?.startCarPlay()})};applyGuard(cfg.fps)
 server=net.createServer(socket=>{if(stopRequested||sessions.size>=8){socket.destroy();return}controlConnections++;handoffRecovery?.networkConnected();if(networkDeadline){clearTimeout(networkDeadline);networkDeadline=undefined}if(controlConnections===1&&currentFps<=60)armVideoDeadline();status('网络控制连接已到达','连接数：'+controlConnections);const stack=new CpStack({...config,main:{...config.main}});sessions.add(stack);stack.setAudioActive(true)
  stack.on('session-active',()=>{if(active&&active!==stack){stack.stop();return}active=stack;status('CarPlay会话已建立，等待视频');guard?.negotiationStarted()})
  stack.on('video-config',(data:Buffer)=>{if(stopRequested||active&&active!==stack)return;videoOwner=stack;const generation=videoGate?.configure(data);status('已收到视频配置');send({type:'video-config',data,generation,width:cfg.width,height:cfg.height})})
  stack.on('video-frame',(data:Buffer)=>{if(stopRequested||active&&active!==stack)return;videoOwner=stack;receivedFrames++;if(videoRecovery){clearTimeout(videoRecovery);videoRecovery=undefined}if(!hadVideo){hadVideo=true;guard?.videoStarted();if(videoDeadline)clearTimeout(videoDeadline);status('正在接收CarPlay视频');send({type:'connected'})}videoGate?.push(data,Number(process.hrtime.bigint()/1000n))})
  stack.on('video-ended',()=>{if(hadVideo&&!stopRequested&&active===stack){videoGate?.recover('reconnect');if(videoRecovery)clearTimeout(videoRecovery);status('视频通道正在重新连接');videoRecovery=setTimeout(()=>{status('视频通道恢复超时');shutdown()},8000)}})
  stack.on('session-ended',()=>{
   sessions.delete(stack);const wasActive=active===stack;if(wasActive)active=undefined;stack.stop()
   if(stopRequested||active&&!wasActive)return
   if(hadVideo){if(wasActive)shutdown();return}
   if(wasActive&&currentFps<=60){status('iPhone结束连接，未收到视频，请重新启动接收');shutdown()}
   else guard?.failed()
  })
  stack.on('host-ui-requested',()=>send({type:'show-settings'}));stack.on('error',()=>status('CarPlay协议错误，请重新启动接收'))
  stack.on('protocol-state',(stage:string,detail:string)=>status(stage,detail));stack.deviceFilter=id=>id.replace(/[^a-f0-9]/gi,'').toLowerCase()===cfg.targetBluetooth.replace(/[^a-f0-9]/gi,'').toLowerCase();
  stack.attachSocket(socket)
 });server.on('error',()=>{if(!stopRequested){status('TCP17000接收端口不可用，请检查端口占用');shutdown()}});await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen({port:17000,host:'::',ipv6Only:false},resolve)});if(stopRequested)return;status('网络接收端已就绪','TCP17000；IPv4/IPv6双栈监听；接入点标识：'+(cfg.wirelessMode==='lan'&&cfg.accessPointMac?'已提供':'使用接口标识'))
 bonjour=new Discovery(cfg.networkInterface,{deviceId,pk:identity.pkHex,pi:identity.pairingId,btMac:bt.adapter},cfg.targetBluetooth,()=>!!accessory?.authenticated,s=>status(s))
 let stream:Duplex
 status('连接iPhone蓝牙RFCOMM服务');bluetooth=spawn(process.env.WINPLAY_NATIVE!,['bluetooth',cfg.targetBluetooth],{windowsHide:true});let diagnostic='';bluetooth.stderr!.on('data',b=>diagnostic=(diagnostic+b).slice(-512));bluetooth.on('error',()=>{status('蓝牙桥接启动失败');shutdown()});bluetooth.on('exit',code=>{if(stopRequested||bluetoothReleased)return;if(!hadVideo&&code!==0){status('蓝牙RFCOMM连接失败',diagnostic);shutdown()}})
  stream=new Duplex({read(){},write(chunk,_encoding,cb){bluetooth!.stdin!.write(chunk,cb)}});bluetooth.stdout!.on('data',b=>stream.push(b));bluetooth.stdout!.on('end',()=>stream.push(null));stream.on('close',()=>bluetooth?.kill())
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
 ticker=setInterval(()=>{videoGate?.tick();send({type:'metrics',requested:settings.fps,attempt:currentFps,receivedFps:receivedFrames});receivedFrames=0;if(++videoDiagnosticTick%10===0&&videoGate)send({type:'video-diagnostic',...videoGate.diagnostics()});if(playing)send({type:'position',positionMs:playing.position()})},1000)
 send({type:'started',requested:cfg.fps});status(cfg.wirelessMode==='lan'?'局域网接收已启动，请确认两端在同一Wi-Fi':'本机热点接收已启动，请让iPhone接入Windows移动热点')
}
function shutdown(){if(stopRequested)return;stopRequested=true;videoGate?.close();videoGate=undefined;videoOwner=undefined;playing?.close();guard?.cancel();handoffRecovery?.cancel();if(networkDeadline)clearTimeout(networkDeadline);if(videoRecovery)clearTimeout(videoRecovery);if(ticker)clearInterval(ticker);if(videoDeadline)clearTimeout(videoDeadline);for(const stack of [...sessions])stack.stop();sessions.clear();accessory?.close();setIapRelayFactory(undefined);bluetooth?.kill();closeMedia();bonjour?.destroy();server?.close();hadVideo=false;send({type:'stopped'});setTimeout(()=>process.exit(0),250).unref()}
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
 }catch(e){status((e as Error).message);shutdown()}})
process.on('disconnect',shutdown);process.on('uncaughtException',()=>{status('接收进程异常，请重新启动接收');shutdown()})
