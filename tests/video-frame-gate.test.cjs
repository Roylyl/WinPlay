const test=require('node:test'),assert=require('node:assert/strict');
const {VideoFrameGate}=require('../build/engine/videoFrameGate');
const description=Buffer.from([1,66,0,31,255,225,0]);
function frame(type=1,bytes=5,lengthSize=4){
 const data=Buffer.alloc(bytes);data.writeUIntBE(bytes-lengthSize,0,lengthSize);data[lengthSize]=type;return data;
}
function fixture(options={}){
 let now=0,requests=0;const sent=[],pauses=[];
 const gate=new VideoFrameGate({send:packet=>sent.push(packet),pause:value=>pauses.push(value),requestKey:()=>requests++,now:()=>now,...options});
 const generation=gate.configure(description);
 return {gate,sent,pauses,generation,requests:()=>requests,advance:ms=>now+=ms,ack:packet=>gate.ack({frameId:packet.frameId,generation:packet.generation,decoderQueueSize:0})};
}
test('normal decoder pressure pauses at 16 and resumes at eight without dropping P-frame references',()=>{
 const f=fixture();for(let n=0;n<16;n++)f.gate.push(frame(n?1:5),n);
 assert.deepEqual(f.pauses,[true]);assert.equal(f.gate.diagnostics().inFlight,16);
 for(const packet of f.sent.slice(0,7))f.ack(packet);assert.deepEqual(f.pauses,[true]);
 f.ack(f.sent[7]);assert.deepEqual(f.pauses,[true,false]);
 for(let n=16;n<24;n++)f.gate.push(frame(),n);
 assert.deepEqual(f.sent.map(packet=>packet.timestamp),Array.from({length:24},(_,n)=>n));
 assert.equal(f.gate.diagnostics().droppedFrames,0);assert.equal(f.gate.diagnostics().recoveries,0);
});
test('byte pressure bounds large compressed IPC payloads before the frame-count limit',()=>{
 const f=fixture({maxBytes:100});f.gate.push(frame(5,60),0);f.gate.push(frame(1,60),1);
 assert.deepEqual(f.pauses,[true]);assert.equal(f.gate.diagnostics().inFlightBytes,120);
 f.ack(f.sent[0]);assert.deepEqual(f.pauses,[true]);f.ack(f.sent[1]);assert.deepEqual(f.pauses,[true,false]);
 assert.equal(f.gate.diagnostics().receivedBytes,120);assert.equal(f.gate.diagnostics().maxInFlightBytes,120);
});
test('unexpected compressed-frame overflow discards deltas until a fresh reset IDR',()=>{
 const f=fixture({limit:2});f.gate.push(frame(5),0);f.gate.push(frame(),1);const old=f.sent[0];
 f.gate.push(frame(),2);f.gate.push(frame(),3);
 assert.equal(f.sent.length,2);assert.equal(f.gate.diagnostics().droppedFrames,2);assert.equal(f.requests(),1);
 f.gate.push(frame(5),4);assert.equal(f.sent.length,3);assert.equal(f.sent[2].reset,true);assert.equal(f.sent[2].resetReason,'transport-overflow');assert.notEqual(f.sent[2].generation,old.generation);
 f.ack(old);assert.equal(f.gate.diagnostics().inFlight,1);
 f.gate.push(frame(),5);assert.equal(f.sent[3].reset,undefined);assert.equal(f.sent[3].generation,f.sent[2].generation);
});
test('stalled ACKs release bounded TCP pressure and request keyframes at most once per 900ms',()=>{
 const f=fixture({limit:2});f.gate.push(frame(5),0);f.gate.push(frame(),1);
 f.advance(1999);f.gate.tick();assert.equal(f.gate.diagnostics().recoveries,0);
 f.advance(1);f.gate.tick();assert.equal(f.gate.diagnostics().recoveries,1);assert.deepEqual(f.pauses,[true,false]);
 f.gate.push(frame(),2);f.gate.tick();assert.equal(f.requests(),1);
 f.advance(899);f.gate.tick();assert.equal(f.requests(),1);f.advance(1);f.gate.tick();assert.equal(f.requests(),2);
 f.gate.push(frame(5),3);assert.equal(f.sent.at(-1).reset,true);assert.equal(f.sent.at(-1).resetReason,'decoder-stall');
});
test('duplicate and previous-generation ACKs cannot release current compressed frames',()=>{
 const f=fixture();f.gate.push(frame(5),0);const first=f.sent[0];f.ack(first);f.ack(first);
 assert.equal(f.gate.diagnostics().inFlight,0);f.gate.configure(description);f.gate.push(frame(5),1);f.ack(first);
 assert.equal(f.gate.diagnostics().inFlight,1);assert.equal(f.gate.diagnostics().inFlightBytes,5);
 f.gate.close();assert.equal(f.gate.diagnostics().inFlightBytes,0);
});
test('AVCC keyframe gating follows the advertised NAL length prefix',()=>{
 for(const lengthSize of [1,2,4]){
  const f=fixture(),cfg=Buffer.from(description);cfg[4]=252+lengthSize-1;f.gate.configure(cfg);
  f.gate.push(frame(1,lengthSize+1,lengthSize),0);assert.equal(f.sent.length,0);
  f.gate.push(frame(5,lengthSize+1,lengthSize),1);assert.equal(f.sent.length,1);
 }
});
test('transport recovery causes remain distinguishable from a stalled decoder',()=>{
 const f=fixture();for(const reason of ['ipc-overflow','reconnect']){f.gate.recover(reason);f.gate.push(frame(5),1);assert.equal(f.sent.at(-1).resetReason,reason)}
});
