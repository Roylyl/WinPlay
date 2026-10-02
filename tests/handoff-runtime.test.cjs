const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {Duplex}=require('node:stream');
const {HandoffRecovery}=require('../build/engine/handoffRecovery');
const {receiverNetwork}=require('../build/engine/networkMode');

async function receiver({interruptAt}={}){
 let now=0,receive,server;
 const timers=new Map(),messages=[],accessories=[];
 const clock={setTimeout(callback,delay){const token={unref(){}};timers.set(token,{callback,due:now+delay});return token},clearTimeout:token=>timers.delete(token)};
 class Recovery extends HandoffRecovery{constructor(options){super(options,clock)}}
 class Accessory extends EventEmitter{
  authenticated=true;
  constructor(link,_signer,cfg){super();this.link=link;this.cfg=cfg;this.sent=[];accessories.push(this)}
  async startCarPlay(){this.sent.push(this.cfg.host);this.emit('negotiation')}
  close(){}
 }
 class CpStack extends EventEmitter{setAudioActive(){}attachSocket(){}stop(){}}
 const phone='02:00:00:00:00:02',mac='02:00:00:00:00:01';
 const addresses=[{family:'IPv4',address:'192.0.2.2',netmask:'255.255.255.0',mac,internal:false},{family:'IPv6',address:'fe80::1',scopeid:12,mac,internal:false}];
 const modules={
  'node:fs':{readFileSync:()=>Buffer.alloc(10)},'node:path':require('node:path'),'node:stream':{Duplex},
  'node:os':{networkInterfaces:()=>({WLAN:addresses})},
  'node:net':{createServer:callback=>{server=new EventEmitter();server.accept=callback;server.listen=(_options,ready)=>{if(interruptAt==='listen')receive({command:'stop'});ready()};server.close=()=>{};return server}},
  'node:child_process':{spawn:(_file,args)=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin={write:(_data,done)=>done?.()};p.kill=()=>{};
   if(args[0]==='list')queueMicrotask(()=>{if(interruptAt==='native')receive({command:'stop'});p.stdout.emit('data',JSON.stringify({adapter:mac,devices:[{address:phone}]}));p.emit('close',0)});return p}},
  './discovery':{Discovery:class{destroy(){}}},'./protocol/cpStack':{CpStack},
  './protocol/identity':{loadOrCreateIdentity:()=>({pubRaw:Buffer.alloc(32),pkHex:'public-fixture',pairingId:'public-fixture'}),accessoryDeviceId:()=>mac},
  './auth':{LocalSigner:class{}},'./storage':{dataDir:'public-fixture'},
  './frameRateFallback':require('../build/engine/frameRateFallback'),
  './iap':{Accessory,IapLink:class extends EventEmitter{constructor(stream){super();this.stream=stream}}},
  './nowPlaying':{NowPlaying:class{position(){return 0}close(){}}},'./relay':{setIapRelayFactory:()=>{}},
  './media':{closeMedia:()=>{}},'./networkMode':{receiverNetwork,accessPointIdentifier:()=>mac},'./handoffRecovery':{HandoffRecovery:Recovery},'./videoFrameGate':require('../build/engine/videoFrameGate')
 };
 const processMock={connected:true,env:{WINPLAY_NATIVE:'public-native',WINPLAY_RESOURCES:'public-resources'},send:message=>messages.push(message),
  on:(event,callback)=>{if(event==='message')receive=callback},once:()=>{},exit:()=>{}};
 const context={require:name=>{assert(name in modules,'unexpected runtime dependency '+name);return modules[name]},exports:{},Buffer,console:{},process:processMock,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval:()=>({unref(){}}),clearInterval:()=>{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../build/engine/run'),'utf8'),context);
 await receive({command:'start',settings:{networkInterface:'WLAN',wirelessMode:'lan',targetBluetooth:phone,ssid:'Public fixture',password:'public-fixture',channel:6,width:1280,height:720,fps:60}});
 const advance=milliseconds=>{const until=now+milliseconds;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=until).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;const [token,timer]=next;now=timer.due;timers.delete(token);timer.callback()}now=until};
 return {messages,accessory:accessories[0],advance,accept:()=>server.accept({destroy(){}}),stop:()=>receive({command:'stop'})};
}

test('actual receiver retries only the handoff address and keeps the original 45-second network deadline',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(12000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2','fe80::1']);
 r.advance(8000);assert(r.messages.some(message=>message.status==='仍在等待iPhone网络连接'));
 r.advance(24999);assert(!r.messages.some(message=>message.type==='stopped'));
 r.advance(1);assert(r.messages.some(message=>message.status==='iPhone网络连接超时'));assert(r.messages.some(message=>message.type==='stopped'));
});

test('actual TCP acceptance cancels address retries and LAN notices',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(1000);r.accept();r.advance(21000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2']);assert(!r.messages.some(message=>message.status==='仍在等待iPhone网络连接'));
 await r.stop();
});

test('stopping the receiver cancels all recovery and timeout actions',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();await r.stop();const count=r.messages.length;r.advance(60000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2']);assert.equal(r.messages.length,count);
});

test('stopping during native enumeration or listener initialization cannot restart receiving',async()=>{
 for(const interruptAt of ['native','listen']){
  const r=await receiver({interruptAt});r.advance(60000);
  assert.equal(r.accessory,undefined);assert(!r.messages.some(message=>message.type==='started'));
 }
});

test('a late TCP connection receives its own video deadline instead of immediately timing out',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(44000);r.accept();r.advance(44999);
 assert(!r.messages.some(message=>message.type==='stopped'));r.advance(1);
 assert(r.messages.some(message=>message.status==='CarPlay视频连接超时'));
});

test('an authenticated Bluetooth channel closing does not make optional recovery abort the network wait',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.accessory.link.emit('transport-closed');r.advance(12000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2']);assert(!r.messages.some(message=>message.type==='stopped'));
 r.advance(32999);assert(!r.messages.some(message=>message.type==='stopped'));r.advance(1);
 assert(r.messages.some(message=>message.status==='iPhone网络连接超时'));
});
