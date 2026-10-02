const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),crypto=require('node:crypto');const {ScreenStream}=require('../build/engine/protocol/screenStream');const {chachaSeal,nonce64}=require('../build/engine/protocol/crypto');
const {VideoFrameGate}=require('../build/engine/videoFrameGate');
const {EventEmitter}=require('node:events');
test('duplicate and empty video configs preserve encrypted frame nonce progression',async()=>{const key=crypto.randomBytes(32),stream=new ScreenStream(key),configs=[],frames=[];stream.on('config',b=>configs.push(b));stream.on('frame',b=>frames.push(b));const port=await stream.listen(),socket=net.connect({port,host:'127.0.0.1'});try{await new Promise(r=>socket.once('connect',r));const config=Buffer.from([1,66,0,31,255,225,0]);function configPacket(data){const h=Buffer.alloc(128);h.writeUInt32LE(data.length);h[4]=1;return Buffer.concat([h,data])}function framePacket(n){const data=Buffer.from([0,0,0,1,5]),h=Buffer.alloc(128);h.writeUInt32LE(data.length+16);return Buffer.concat([h,chachaSeal(key,nonce64(BigInt(n)),data,h)])}const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('video timeout')),2000);stream.on('frame',()=>{if(frames.length===2){clearTimeout(timer);resolve()}})});socket.write(Buffer.concat([configPacket(config),framePacket(0),configPacket(config),configPacket(Buffer.alloc(0)),framePacket(1)]));await received;assert.equal(configs.length,1);assert.equal(frames.length,2)}finally{socket.destroy();stream.stop()}});

function timeout(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('local transport timeout')),2000))]).finally(()=>clearTimeout(timer))}
test('local video burst backpressures at 16 while an independent control/audio channel keeps delivering',async()=>{
 const key=crypto.randomBytes(32),stream=new ScreenStream(key),sent=[],errors=[];
 let at16,at24;const firstBurst=new Promise(resolve=>at16=resolve),lastBurst=new Promise(resolve=>at24=resolve);
 const gate=new VideoFrameGate({send:packet=>{sent.push(packet);if(sent.length===16)at16();if(sent.length===24)at24()},pause:paused=>stream.setPaused(paused),requestKey:()=>{}});
 gate.configure(Buffer.from([1,66,0,31,255,225,0]));stream.on('frame',data=>gate.push(data,sent.length));stream.on('receive-error',error=>errors.push(error));
 const videoPort=await stream.listen(),video=net.connect({port:videoPort,host:'127.0.0.1'}),controlServer=net.createServer();
 let control;
 try{
  await timeout(new Promise(resolve=>video.once('connect',resolve)));
  await new Promise(resolve=>controlServer.listen(0,'127.0.0.1',resolve));
  const controlDelivered=new Promise(resolve=>controlServer.once('connection',socket=>{socket.once('data',()=>{socket.destroy();resolve()})}));
  const packets=Array.from({length:24},(_,n)=>{const data=Buffer.alloc(32768),header=Buffer.alloc(128);data.writeUInt32BE(data.length-4);data[4]=n?1:5;data.writeUInt32BE(n,5);header.writeUInt32LE(data.length+16);return Buffer.concat([header,chachaSeal(key,nonce64(BigInt(n)),data,header)])});
  video.write(Buffer.concat(packets));await timeout(firstBurst);assert.equal(sent.length,16);assert.equal(gate.diagnostics().paused,true);
  control=net.connect({port:controlServer.address().port,host:'127.0.0.1'},()=>control.write('synthetic independent channel'));
  await timeout(controlDelivered);assert.equal(sent.length,16);
  for(const packet of sent.slice(0,8))gate.ack(packet);
  await timeout(lastBurst);assert.deepEqual(sent.map(packet=>packet.data.readUInt32BE(5)),Array.from({length:24},(_,n)=>n));
  assert.equal(gate.diagnostics().droppedFrames,0);assert.deepEqual(errors,[]);
 }finally{gate.close();video.destroy();control?.destroy();stream.stop();await new Promise(resolve=>controlServer.close(resolve))}
});
test('paused video parsing has a hard accumulated-byte limit instead of unbounded buffering',()=>{
 class Socket extends EventEmitter{remoteAddress='127.0.0.1';remotePort=0;destroyed=false;pause(){}resume(){}destroy(){this.destroyed=true;this.emit('close')}}
 const stream=new ScreenStream(Buffer.alloc(32)),socket=new Socket(),errors=[];
 stream.on('receive-error',reason=>errors.push(reason));stream.setPaused(true);stream._onConnection(socket);
 socket.emit('data',Buffer.alloc(16*1024*1024+1));assert.equal(socket.destroyed,true);assert.deepEqual(errors,['视频接收缓冲超限']);stream.stop();
});
