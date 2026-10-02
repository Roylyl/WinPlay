const test=require('node:test'),assert=require('node:assert/strict');const Receiver=require('../src/ui/video-decoder.js');
const config=Uint8Array.from([1,66,0,31,255,225,0]);const key={data:Uint8Array.from([0,0,0,1,5]),timestamp:0};
function fixture(){const decoders=[],outputs=[];let requests=0;class Decoder{static async isConfigSupported(){return {supported:true}}constructor(callbacks){this.callbacks=callbacks;this.decodeQueueSize=0;this.frames=[];decoders.push(this)}configure(c){this.config=c}close(){this.closed=true}decode(c){this.frames.push(c)}}const r=new Receiver({Decoder,Chunk:class{constructor(c){Object.assign(this,c)}},requestKey:()=>requests++,output:f=>outputs.push(f),fail:r=>assert.fail(r),recover:()=>{}});return {r,decoders,outputs,requests:()=>requests}}
test('duplicate AVC config preserves decoder; changed config discards stale output and awaits IDR',async()=>{const f=fixture();try{await f.r.configure({data:config});await f.r.configure({data:config});assert.equal(f.decoders.length,1);f.r.decode(key);const next=config.slice();next[3]=32;await f.r.configure({data:next});let closed=false;f.decoders[0].callbacks.output({close(){closed=true}});assert.ok(closed);assert.equal(f.outputs.length,0);f.r.decode({data:[0,0,0,1,1],timestamp:1});assert.equal(f.decoders[1].frames.length,0);f.r.decode(key);assert.equal(f.decoders[1].frames.length,1);assert.ok(f.requests()>0)}finally{f.r.close()}});
test('hardware decoder failure rebuilds software decoder and requests fresh IDR',async()=>{const f=fixture();try{await f.r.configure({data:config});f.decoders[0].callbacks.error(Error('hardware reset'));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.decoders[1].config.hardwareAcceleration,'prefer-software');assert.ok(f.r.awaitKey);f.r.decode(key);assert.equal(f.decoders[1].frames.length,1)}finally{f.r.close()}});
test('initialization queue overflow discards the entire incomplete GOP and waits for a fresh IDR',async()=>{
 const f=fixture();let supported;f.r.api.Decoder.isConfigSupported=()=>new Promise(resolve=>supported=resolve);
 try{const configure=f.r.configure({data:config});f.r.decode(key);for(let i=1;i<24;i++)f.r.decode({data:[0,0,0,1,1],timestamp:i});assert.equal(f.r.pending.length,0);supported({supported:true});await configure;
  assert.equal(f.decoders[0].frames.length,0);assert.equal(f.r.awaitKey,true);f.r.decode({data:[0,0,0,1,1],timestamp:24});assert.equal(f.decoders[0].frames.length,0);f.r.decode({...key,timestamp:25});assert.equal(f.decoders[0].frames.length,1);assert.equal(f.r.awaitKey,false);assert.ok(f.requests()>0);
 }finally{f.r.close()}
});
test('an IDR received after initialization overflow restores a complete pending reference chain',async()=>{
 const f=fixture();let supported;f.r.api.Decoder.isConfigSupported=()=>new Promise(resolve=>supported=resolve);
 try{const configure=f.r.configure({data:config});f.r.decode(key);for(let i=1;i<17;i++)f.r.decode({data:[0,0,0,1,1],timestamp:i});f.r.decode({...key,timestamp:20});f.r.decode({data:[0,0,0,1,1],timestamp:21});supported({supported:true});await configure;
  assert.deepEqual(f.decoders[0].frames.map(frame=>frame.timestamp),[20,21]);assert.equal(f.r.awaitKey,false);
 }finally{f.r.close()}
});
test('transport reset replaces the decoder and decodes its supplied IDR without selecting software fallback',async()=>{
 const f=fixture();try{await f.r.configure({data:config});f.r.decode(key);f.r.decode({...key,timestamp:10,reset:true});f.r.decode({data:[0,0,0,1,1],timestamp:11});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.decoders.length,2);assert.equal(f.decoders[0].closed,true);assert.equal(f.decoders[1].config.hardwareAcceleration,'prefer-hardware');assert.deepEqual(f.decoders[1].frames.map(frame=>frame.timestamp),[10,11]);let closed=false;f.decoders[0].callbacks.output({close(){closed=true}});assert.ok(closed);assert.equal(f.outputs.length,0);
 }finally{f.r.close()}
});
test('decoder dequeue releases only consumed frame acknowledgments and wakes paused delivery without new input',async()=>{
 const acknowledgments=[],f=fixture();f.r.api.ack=(message,state)=>acknowledgments.push({message,state});let dequeue;
 f.r.api.Decoder.prototype.addEventListener=(event,listener)=>{if(event==='dequeue')dequeue=listener};f.r.api.Decoder.prototype.decode=function(chunk){this.frames.push(chunk);this.decodeQueueSize++};
 try{await f.r.configure({data:config});f.r.decode({...key,frameId:1});f.r.decode({data:[0,0,0,1,1],timestamp:1,frameId:2});assert.equal(acknowledgments.length,0);assert.equal(f.r.submitted.length,2);
  f.decoders[0].decodeQueueSize=1;dequeue();assert.equal(acknowledgments.length,1);assert.equal(acknowledgments[0].message.frameId,1);assert.equal(acknowledgments[0].state.decoderQueueSize,1);
  f.decoders[0].decodeQueueSize=0;dequeue();assert.equal(acknowledgments.length,2);assert.equal(f.r.submitted.length,0);
 }finally{f.r.close()}
});
test('dequeue acknowledgments cannot consume newly submitted frames during synchronous delivery wakeup',async()=>{
 const acknowledgments=[],f=fixture();let dequeue;f.r.api.Decoder.prototype.addEventListener=(event,listener)=>{if(event==='dequeue')dequeue=listener};f.r.api.Decoder.prototype.decode=function(chunk){this.frames.push(chunk);this.decodeQueueSize++};
 f.r.api.ack=message=>{acknowledgments.push(message.frameId);if(message.frameId===1)f.r.decode({data:[0,0,0,1,1],timestamp:2,frameId:3})};
 try{await f.r.configure({data:config});f.r.decode({...key,frameId:1});f.r.decode({data:[0,0,0,1,1],timestamp:1,frameId:2});f.decoders[0].decodeQueueSize=0;dequeue();assert.deepEqual(acknowledgments,[1,2]);assert.equal(f.r.submitted.length,1);assert.equal(f.r.submitted[0].frameId,3);assert.equal(f.decoders[0].decodeQueueSize,1);f.decoders[0].decodeQueueSize=0;dequeue();assert.deepEqual(acknowledgments,[1,2,3]);
 }finally{f.r.close()}
});
test('decoder-stall transport reset selects software and retains its supplied IDR',async()=>{
 const f=fixture();try{await f.r.configure({data:config});f.r.decode(key);f.r.decode({...key,timestamp:10,reset:true,resetReason:'decoder-stall'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.r.software,true);assert.equal(f.r.retries.length,1);assert.equal(f.decoders[1].config.hardwareAcceleration,'prefer-software');assert.deepEqual(f.decoders[1].frames.map(frame=>frame.timestamp),[10]);
 }finally{f.r.close()}
});
test('repeated decoder watchdog stalls terminate through the existing bounded recovery limit',async()=>{
 const f=fixture(),failures=[],acknowledgments=[];f.r.api.fail=reason=>failures.push(reason);f.r.api.ack=frame=>acknowledgments.push(frame.frameId);
 try{await f.r.configure({data:config});for(let index=1;index<=4;index++){f.r.decode({...key,timestamp:index,frameId:index,reset:true,resetReason:'decoder-stall'});await new Promise(resolve=>setImmediate(resolve))}assert.equal(f.decoders.length,4);assert.equal(f.r.retries.length,3);assert.equal(f.r.ready,false);assert.equal(failures.length,1);assert.ok(failures[0].includes('视频恢复失败'));assert.ok(acknowledgments.includes(4));
 }finally{f.r.close()}
});
test('a synchronous decoder failure preserves IDR waiting and does not release an undefined decoder',async()=>{
 const f=fixture();f.r.api.Decoder.prototype.decode=function(chunk){this.frames.push(chunk);if(f.decoders.length===1)this.callbacks.error(Error('synchronous hardware failure'))};
 try{await f.r.configure({data:config});assert.doesNotThrow(()=>f.r.decode(key));assert.equal(f.r.awaitKey,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.decoders.length,2);assert.equal(f.r.retries.length,1);assert.equal(f.r.awaitKey,true);assert.doesNotThrow(()=>f.r.releaseAcks(undefined));f.r.decode(key);assert.equal(f.r.awaitKey,false);
 }finally{f.r.close()}
});
