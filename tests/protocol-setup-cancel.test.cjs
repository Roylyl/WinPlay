const test=require('node:test'),assert=require('node:assert/strict');
const {CpStack}=require('../build/engine/protocol/cpStack');
const {TimingSync}=require('../build/engine/protocol/timingServer');
const {ScreenStream}=require('../build/engine/protocol/screenStream');
const {IapTunnel}=require('../build/engine/protocol/iapTunnel');
const {encodeBplist}=require('../build/engine/protocol/bplist');
const media=require('../build/engine/media');
const session=()=>({pairVerify:{sharedSecret:Buffer.alloc(32,7)},audioMeta:[],pendingEvents:[],peerHost:'127.0.0.1'});

test('timing, video and iAP listeners created after cancellation are immediately disposed',async t=>{
 for(const [Service,start] of [
  [TimingSync,(stack,s)=>stack._handleSetup({body:encodeBplist({deviceID:'public-target'})},s)],
  [ScreenStream,(stack,s)=>stack._setupScreen({streamConnectionID:1},s)],
  [IapTunnel,(stack,s)=>stack._setupDataStream({clientTypeUUID:'E9459FD0-BCAD-4C45-820F-1E72447EF2F2',seed:1},s)]
 ]){
  const listen=Service.prototype.listen,stop=Service.prototype.stop;let ready,stopped=0;
  Service.prototype.listen=function(){return new Promise(resolve=>ready=resolve)};
  Service.prototype.stop=function(){stopped++};
  try{
   const stack=new CpStack({mfi:{}}),s=session(),pending=start(stack,s);
   stack._teardown(s);ready(45678);
   await assert.rejects(pending,/closed during setup/);assert.equal(stopped,1,Service.name);assert.equal(s.event,null);assert.equal(s.audioMeta.length,0);
  }finally{Service.prototype.listen=listen;Service.prototype.stop=stop}
 }
});

test('an event server binding after cancellation closes instead of becoming an orphan listener',async()=>{
 const stack=new CpStack({mfi:{}}),s=session(),pending=stack._openEventChannel(s);
 stack._teardown(s);await assert.rejects(pending,/closed during setup/);assert.equal(s.event,null);
});

test('an audio receiver completing after cancellation is closed without publishing an active stream',async()=>{
 const open=media.openAudioReceiver,close=media.closeAudioReceiver;let ready;const closed=[];
 media.openAudioReceiver=()=>new Promise(resolve=>ready=resolve);media.closeAudioReceiver=id=>closed.push(id);
 try{
  const stack=new CpStack({mfi:{}}),s=session(),pending=stack._setupAudio({streamConnectionID:1,audioType:'media',audioFormat:0x800000},s,102);
  stack._teardown(s);ready({streamId:91,dataPort:45678,controlPort:45679});
  await assert.rejects(pending,/closed during setup/);assert.deepEqual(closed,[91]);assert.equal(s.audioMeta.length,0);assert.equal(stack._audioById.size,0);
 }finally{media.openAudioReceiver=open;media.closeAudioReceiver=close}
});
