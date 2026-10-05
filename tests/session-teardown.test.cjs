const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {once}=require('node:events');
const {CpStack}=require('../build/engine/protocol/cpStack');
const {FrameRateFallback}=require('../build/engine/frameRateFallback');
const {encodeBplist}=require('../build/engine/protocol/bplist');

async function connection(t,deviceFilter=null){
 const stack=new CpStack({mfi:{}});stack._openIapMessageRelay=()=>{};
 stack.deviceFilter=deviceFilter;
 const server=net.createServer(socket=>stack.attachSocket(socket));server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=net.connect(server.address().port,'127.0.0.1');await once(client,'connect');
 t.after(()=>{client.destroy();stack.stop();server.close()});
 let sequence=0;
 async function request(method,body=Buffer.alloc(0),expected=200){
  const response=once(client,'data');
  client.write(Buffer.concat([Buffer.from(`${method} / RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Length: ${body.length}\r\n\r\n`),body]));
  const [data]=await response;assert.equal(Number(data.toString().split(' ')[1]),expected);return data;
 }
 return {stack,client,request};
}
test('full TEARDOWN replies before host shutdown and emits session-ended exactly once',async t=>{
 const {stack,client,request}=await connection(t);let ended=0;
 await request('RECORD');stack.on('session-ended',()=>{ended++;stack.stop()});
 const notified=once(stack,'session-ended');await request('TEARDOWN');await notified;
 if(!client.destroyed)await once(client,'close');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,1);
});
test('stream-only TEARDOWN and rejected control connection do not end the live session',async t=>{
 const {stack,client,request}=await connection(t);let ended=0;stack.on('session-ended',()=>ended++);
 await request('RECORD');await request('TEARDOWN',encodeBplist({streams:[{type:102}]}));
 const background=net.connect(client.remotePort,'127.0.0.1');await once(background,'connect');
 background.destroy();await once(background,'close');await new Promise(resolve=>setTimeout(resolve,15));assert.equal(ended,0);
 const notified=once(stack,'session-ended');await request('TEARDOWN');await notified;assert.equal(ended,1);
 client.destroy();await once(client,'close');await new Promise(resolve=>setImmediate(resolve));assert.equal(ended,1);
});
test('pre-RECORD session TEARDOWN can still trigger the armed high-frame-rate fallback',async t=>{
 const {stack,request}=await connection(t);const retries=[];
 const guard=new FrameRateFallback(120,fps=>retries.push(fps),2000);t.after(()=>guard.cancel());guard.negotiationStarted();
 stack.on('session-ended',()=>guard.failed());const notified=once(stack,'session-ended');
 await request('TEARDOWN');await notified;assert.deepEqual(retries,[90]);
});

test('release receiver rejects RECORD until the same connection has completed target SETUP',async t=>{
 const {stack,request}=await connection(t,id=>id==='public-target');let active=0;
 stack.on('session-active',()=>active++);
 await request('RECORD',Buffer.alloc(0),403);assert.equal(active,0);
 await request('SETUP',encodeBplist({deviceID:'other-target'}),403);
 await request('RECORD',Buffer.alloc(0),403);assert.equal(active,0);
 await request('SETUP',encodeBplist({deviceID:'public-target'}));
 await request('RECORD');assert.equal(active,1);
});

test('an unaccepted preconnection cannot trigger session-ended or frame-rate fallback',async t=>{
 const {stack,request,client}=await connection(t,()=>false),retries=[];
 const guard=new FrameRateFallback(120,fps=>retries.push(fps),2000);t.after(()=>guard.cancel());guard.negotiationStarted();
 stack.on('session-ended',()=>guard.failed());
 await request('RECORD',Buffer.alloc(0),403);await request('TEARDOWN');
 client.destroy();await once(client,'close');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(retries,[]);
});
