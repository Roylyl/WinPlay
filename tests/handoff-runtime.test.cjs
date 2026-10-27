const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {Duplex}=require('node:stream');
const {HandoffRecovery}=require('../build/engine/handoffRecovery');
const {receiverNetwork}=require('../build/engine/networkMode');

async function receiver({interruptAt,fps=60}={}){
 let now=0,receive,server,relayFactory,announcements=0;
 const timers=new Map(),messages=[],accessories=[],stacks=[],bridges=[];
 const clock={setTimeout(callback,delay){const token={unref(){}};timers.set(token,{callback,due:now+delay});return token},clearTimeout:token=>timers.delete(token)};
 class Recovery extends HandoffRecovery{constructor(options){super(options,clock)}}
 class Accessory extends EventEmitter{
  authenticated=true;
  constructor(link,_signer,cfg,options){super();this.link=link;this.cfg=cfg;this.options=options;this.sent=[];accessories.push(this)}
  async startCarPlay(){if(this.options.bootstrap===false||!this.options.canStart())return false;this.sent.push(this.cfg.host);this.emit('negotiation');return true}
  close(){this.closed=true;this.emit('closed')}
 }
 class CpStack extends EventEmitter{hasVerifiedSession=false;constructor(){super();stacks.push(this)}setAudioActive(){}attachSocket(socket){this.socket=socket}stop(){this.stopped=true;this.emit('connection-closed')}}
 const fallbackModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../build/engine/frameRateFallback'),'utf8'),{exports:fallbackModule.exports,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});
 const phone='02:00:00:00:00:02',mac='02:00:00:00:00:01';
 const addresses=[{family:'IPv4',address:'192.0.2.2',netmask:'255.255.255.0',mac,internal:false},{family:'IPv6',address:'fe80::1',scopeid:12,mac,internal:false}];
 const modules={
  'node:fs':{readFileSync:()=>Buffer.alloc(10)},'node:path':require('node:path'),'node:stream':{Duplex},
  'node:os':{networkInterfaces:()=>({WLAN:addresses})},
  'node:net':{createServer:callback=>{server=new EventEmitter();server.accept=callback;server.listen=(_options,ready)=>{if(interruptAt==='listen')receive({command:'stop'});ready()};server.close=()=>{};return server}},
  'node:child_process':{spawn:(_file,args)=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin={write:(_data,done)=>done?.()};p.kill=()=>{};
   if(args[0]==='list')queueMicrotask(()=>{if(interruptAt==='native')receive({command:'stop'});p.stdout.emit('data',JSON.stringify({adapter:mac,devices:[{address:phone}]}));p.emit('close',0)});else bridges.push(p);return p}},
  './discovery':{Discovery:class{announce(){announcements++}summary(){return {}}destroy(){}}},'./protocol/cpStack':{CpStack},
  './protocol/identity':{loadOrCreateIdentity:()=>({pubRaw:Buffer.alloc(32),pkHex:'public-fixture',pairingId:'public-fixture'}),accessoryDeviceId:()=>mac},
  './auth':{LocalSigner:class{}},'./storage':{dataDir:'public-fixture'},
  './frameRateFallback':fallbackModule.exports,
  './iap':{Accessory,IapLink:class extends EventEmitter{constructor(stream){super();this.stream=stream}send(){}close(){}}},
  './nowPlaying':{NowPlaying:class{position(){return 0}close(){}}},'./relay':{setIapRelayFactory:value=>relayFactory=value},
  './media':{closeMedia:()=>{}},'./networkMode':{receiverNetwork,accessPointIdentifier:()=>mac},'./handoffRecovery':{HandoffRecovery:Recovery},'./videoFrameGate':require('../build/engine/videoFrameGate')
 };
 const processMock={connected:true,env:{WINPLAY_NATIVE:'public-native',WINPLAY_RESOURCES:'public-resources'},send:message=>messages.push(message),
  on:(event,callback)=>{if(event==='message')receive=callback},once:()=>{},exit:()=>{}};
 const context={require:name=>{assert(name in modules,'unexpected runtime dependency '+name);return modules[name]},exports:{},Buffer,console:{},process:processMock,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval:()=>({unref(){}}),clearInterval:()=>{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../build/engine/run'),'utf8'),context);
 await receive({command:'start',settings:{networkInterface:'WLAN',wirelessMode:'lan',targetBluetooth:phone,ssid:'Public fixture',password:'public-fixture',channel:6,width:1280,height:720,fps}});
 const advance=milliseconds=>{const until=now+milliseconds;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=until).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;const [token,timer]=next;now=timer.due;timers.delete(token);timer.callback()}now=until};
 return {messages,accessory:accessories[0],accessories,stacks,bridges,relay:()=>relayFactory(),announcements:()=>announcements,record:stack=>{stack.hasVerifiedSession=true;stack.emit('session-active')},advance,accept:()=>{server.accept(Object.assign(new EventEmitter(),{destroy(){}}));return stacks.at(-1)},stop:()=>receive({command:'stop'})};
}

test('actual receiver retries only the handoff address and keeps the original 45-second network deadline',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(12000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2','fe80::1']);
 r.advance(8000);assert(r.messages.some(message=>message.status==='仍在等待iPhone网络连接'));
 r.advance(24999);assert(!r.messages.some(message=>message.type==='stopped'));
 r.advance(1);assert(r.messages.some(message=>message.status==='iPhone网络连接超时'));assert(r.messages.some(message=>message.type==='stopped'));
});

test('a verified RECORD cancels address retries and LAN notices',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(1000);r.record(r.accept());r.advance(21000);
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

test('a late verified session receives its own video deadline instead of immediately timing out',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.advance(44000);r.record(r.accept());r.advance(44999);
 assert(!r.messages.some(message=>message.type==='stopped'));r.advance(1);
 assert(r.messages.some(message=>message.status==='CarPlay视频连接超时'));
});

test('an authenticated Bluetooth channel closing does not make optional recovery abort the network wait',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.accessory.link.emit('transport-closed');r.advance(12000);
 assert.deepEqual(r.accessory.sent,['192.0.2.2']);assert(!r.messages.some(message=>message.type==='stopped'));
 r.advance(32999);assert(!r.messages.some(message=>message.type==='stopped'));r.advance(1);
 assert(r.messages.some(message=>message.status==='iPhone网络连接超时'));
});

test('frame-rate fallback after a control connection has bounded 90fps and 60fps attempts',async()=>{
 const r=await receiver({fps:120});await r.accessory.startCarPlay();r.record(r.accept());
 r.advance(20000);assert.equal(r.messages.filter(m=>m.type==='requested-fps').at(-1).attempt,90);r.record(r.accept());
 r.advance(20000);assert.equal(r.messages.filter(m=>m.type==='requested-fps').at(-1).attempt,60);r.record(r.accept());
 r.advance(44999);assert(!r.messages.some(m=>m.type==='stopped'));
 r.advance(1);assert(r.messages.some(m=>m.status==='CarPlay视频连接超时'));
 assert(r.messages.some(m=>m.type==='stopped'));
});

test('TCP probes cannot confirm handoff or permanently consume the control-session limit',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();
 for(let i=0;i<12;i++){const probe=r.accept();probe.emit('session-active');probe.emit('session-ended');probe.emit('connection-closed')}
 assert.equal(r.stacks.length,12);r.advance(12000);assert.deepEqual(r.accessory.sent,['192.0.2.2','fe80::1']);
 r.advance(33000);assert(r.messages.some(message=>message.status==='iPhone网络连接超时'));assert(r.messages.some(message=>message.type==='stopped'));
});

test('inactive connection events cannot alter the live session or trigger a frame-rate retry',async()=>{
 const r=await receiver({fps:120});await r.accessory.startCarPlay();const live=r.accept();r.record(live);const extra=r.accept(),before=r.messages.length;
 extra.emit('error',new Error('public probe error'));extra.emit('protocol-state','旧连接状态','');extra.emit('session-ended');extra.emit('connection-closed');
 assert.equal(r.messages.slice(before).filter(message=>message.type==='status').length,0);assert(!r.messages.some(message=>message.type==='requested-fps'));assert(!live.stopped);await r.stop();
});

test('runtime marks network relay as metadata-only and withdrawal cancels the pending address retry',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();r.accessory.emit('availability',false);r.advance(12000);assert.deepEqual(r.accessory.sent,['192.0.2.2']);
 const relay=r.relay(),tunnel=r.accessories.at(-1);assert.equal(tunnel.options.bootstrap,false);assert.equal(await tunnel.startCarPlay(true),false);relay.destroy();await r.stop();
});

test('old Bluetooth failures after a verified handoff cannot abort the network session',async()=>{
 const r=await receiver();await r.accessory.startCarPlay();const live=r.accept();r.record(live);
 r.accessory.emit('failed','public stale ACK timeout');r.bridges[0].emit('exit',1);
 assert.equal(r.accessory.closed,true);assert(!live.stopped);assert(!r.messages.some(message=>message.type==='stopped'));await r.stop();
 const pending=await receiver();pending.accessory.emit('failed','public initial auth failure');assert(pending.messages.some(message=>message.type==='stopped'));
});
