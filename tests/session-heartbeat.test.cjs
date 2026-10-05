const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {CpStack}=require('../build/engine/protocol/cpStack');
const {TimingSync}=require('../build/engine/protocol/timingServer');
const {KeepAliveServer}=require('../build/engine/protocol/keepAliveServer');
const media=require('../build/engine/media');
const second=1_000_000_000n,base=100n*second;

async function fixture(t){
 const socket=new EventEmitter(),stack=new CpStack({mfi:{}}),events=[];
 Object.assign(socket,{remoteAddress:'127.0.0.1',remotePort:12345,destroyed:false,keepAlive:[],setKeepAlive(...args){this.keepAlive.push(args)},destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close')}}});
 stack._openIapMessageRelay=()=>{};stack.attachSocket(socket);
 const session=[...stack._sessionSock.keys()][0];
 await stack._handle({method:'RECORD',path:'/',headers:{},body:Buffer.alloc(0)},session);stack._recordResponseWritten(session);
 session.lastCtrlReadNs=session.lastPeerReadNs=base;session.timing={lastActivityNs:base,stop(){}};
 stack.on('session-ended',()=>events.push('ended'));stack.on('protocol-state',status=>events.push(status));t.after(()=>stack.stop());
 return {socket,stack,session,events};
}
test('a silent half-open session ends once without needing TCP close from the peer',async t=>{
 const {socket,stack,session,events}=await fixture(t);
 assert.deepEqual(socket.keepAlive,[[true,5000]]);assert.ok(session.heartbeat);
 stack._checkHeartbeat(session,base+14n*second);assert.equal(socket.destroyed,false);
 stack._checkHeartbeat(session,base+15n*second);assert.equal(socket.destroyed,true);assert.equal(session.heartbeat,null);assert.equal(session.closed,true);
 stack._checkHeartbeat(session,base+40n*second);assert.equal(events.filter(e=>e==='ended').length,1);assert.ok(events.includes('iPhone网络连接已断开'));
});
test('a static screen with paused music stays connected as long as timing replies continue',async t=>{
 const {socket,stack,session}=await fixture(t);
 for(const seconds of [20n,60n,180n]){session.timing.lastActivityNs=base+seconds*second;stack._checkHeartbeat(session,base+(seconds+1n)*second)}
 assert.equal(socket.destroyed,false);
});
test('short network interruptions recover and live control, video, events, low-power or audio prevent false disconnects',async t=>{
 const {socket,stack,session}=await fixture(t);
 stack._checkHeartbeat(session,base+14n*second);session.timing.lastActivityNs=base+14n*second;
 stack._checkHeartbeat(session,base+20n*second);assert.equal(socket.destroyed,false);
 for(const key of ['lastCtrlReadNs','lastPeerReadNs']){session[key]=base+60n*second;stack._checkHeartbeat(session,base+61n*second);assert.equal(socket.destroyed,false);session[key]=base}
 session.keepAlive={lastActivityNs:base+60n*second,stop(){}};stack._checkHeartbeat(session,base+61n*second);assert.equal(socket.destroyed,false);session.keepAlive=null;
 const previous=media.audioReceiverLastActivityNs;media.audioReceiverLastActivityNs=id=>id===91?base+60n*second:0n;
 try{session.audioMeta=[{receiverId:91,micStreamId:null}];stack._checkHeartbeat(session,base+61n*second);assert.equal(socket.destroyed,false)}finally{session.audioMeta=[];media.audioReceiverLastActivityNs=previous}
});
test('phones that never establish timing heartbeat rely on TCP keepalive instead of a media-idle timeout',async t=>{
 const {socket,stack,session}=await fixture(t);session.timing.lastActivityNs=0n;
 stack._checkHeartbeat(session,base+300n*second);assert.equal(socket.destroyed,false);
});
test('stopping or replacing the active session prevents stale heartbeat callbacks from ending the new session',async t=>{
 const {socket,stack,session,events}=await fixture(t);stack._liveSession={};stack._checkHeartbeat(session,base+60n*second);assert.equal(socket.destroyed,false);assert.equal(events.length,0);
 stack._liveSession=session;stack.stop();stack._checkHeartbeat(session,base+60n*second);assert.equal(session.heartbeat,null);assert.equal(events.length,0);
});

function response(t1){const msg=Buffer.alloc(32);msg[0]=0x80;msg[1]=211;msg.writeBigUInt64BE(t1,8);return msg}
test('timing accepts only the selected peer and matching pending reply, even when the clock sample is rejected',()=>{
 const timing=new TimingSync('192.0.2.1');timing._peerPort=1234;timing._pendingT1=7n;timing.syncedNtp=()=>0n;
 const peer={address:'::ffff:192.0.2.1',port:1234},packet=response(7n);
 timing._onMessage(packet,{...peer,address:'192.0.2.2'});assert.equal(timing.lastActivityNs,0n);
 timing._onMessage(packet,{...peer,port:5678});assert.equal(timing.lastActivityNs,0n);
 timing._onMessage(response(6n),peer);assert.equal(timing.lastActivityNs,0n);
 timing._onMessage(packet,peer);assert.ok(timing.lastActivityNs>0n);assert.equal(timing._synced,false,'negative RTT is not used for clock calibration');
 const seen=timing.lastActivityNs;timing._onMessage(packet,peer);assert.equal(timing.lastActivityNs,seen,'duplicate replies do not extend liveness');
});
test('a phone-driven timing request works even without an advertised outbound timing port',()=>{
 const timing=new TimingSync('fe80::1234%9'),packet=Buffer.alloc(32),sent=[];packet[0]=0x80;packet[1]=210;timing._sock={send:(...args)=>sent.push(args)};
 timing._onMessage(packet,{address:'fe80::1234',port:5678});assert.ok(timing.lastActivityNs>0n);assert.equal(sent.length,1);assert.equal(sent[0][0][1],211);
});
test('low-power keepalive accepts even an empty target datagram but ignores other hosts',async t=>{
 const heartbeat=new KeepAliveServer('127.0.0.1');await heartbeat.listen();t.after(()=>heartbeat.stop());
 heartbeat._sock.emit('message',Buffer.alloc(0),{address:'127.0.0.2',port:1234});assert.equal(heartbeat.lastActivityNs,0n);
 heartbeat._sock.emit('message',Buffer.alloc(0),{address:'::ffff:127.0.0.1',port:1234});assert.ok(heartbeat.lastActivityNs>0n);
});
