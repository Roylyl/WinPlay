const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const requests=[],contexts=[],nodes=[],messages=[],encoders=[];
 class Node{constructor(){this.port={};nodes.push(this)}connect(){return this}disconnect(){this.disconnected=true}}
 class Context{constructor(){this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};contexts.push(this)}createMediaStreamSource(){return new Node()}createGain(){const node=new Node();node.gain={};return node}async resume(){this.resumed=true}async close(){this.state='closed'}}
 class Encoder{static async isConfigSupported(){return {supported:true}}constructor(callbacks){this.callbacks=callbacks;encoders.push(this)}configure(){this.state='configured'}close(){if(this.state==='closed')throw new Error('already closed');this.state='closed'}}
 const scope={AudioContext:Context,AudioWorkletNode:Node,AudioEncoder:Encoder,navigator:{mediaDevices:{addEventListener(){},enumerateDevices:async()=>[],getUserMedia:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}},winplay:{input:m=>messages.push(m)},setInterval(){},window:{}};
 vm.runInNewContext(fs.readFileSync('src/ui/audio.js','utf8'),scope);
 return {audio:scope.window.winplayAudio,requests,contexts,nodes,messages,encoders,open(codec='pcm'){scope.window.winplayAudio.handle({type:'mic-open',id:1,opts:{codec,sampleRate:48000,channels:1,frameMs:20}})},stream(){const track={stopped:false,stop(){this.stopped=true}};return {track,getTracks:()=>[track]}}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('stopping while microphone permission is pending cancels capture after permission resolves',async()=>{
 const f=fixture();f.open();await settle();assert.equal(f.requests.length,1);f.audio.handle({type:'stopped'});const stream=f.stream();f.requests[0].resolve(stream);await settle();assert.equal(stream.track.stopped,true);assert.equal(f.contexts.length,0);assert.equal(f.messages.length,0);
});
test('retired microphone permission cannot replace capture when a reconnect reuses the stream ID',async()=>{
 const f=fixture();f.open();await settle();f.audio.handle({type:'stopped'});f.open();await settle();const current=f.stream(),retired=f.stream();f.requests[1].resolve(current);await settle();assert.equal(f.contexts.length,1);assert.equal(f.contexts[0].resumed,true);f.requests[0].resolve(retired);await settle();assert.equal(retired.track.stopped,true);assert.equal(current.track.stopped,false);assert.equal(f.contexts.length,1);f.audio.handle({type:'stopped'});assert.equal(current.track.stopped,true);assert.equal(f.contexts[0].state,'closed');assert.equal(f.messages.length,0);
});
test('permission failure from a disconnected microphone does not publish an error into the next connection',async()=>{
 const f=fixture();f.open();await settle();f.audio.handle({type:'stopped'});f.requests[0].reject(new Error('permission denied'));await settle();assert.equal(f.messages.length,0);
});
test('fatal microphone encoder errors stop capture, and retired output cannot enter a new session',async()=>{
 const f=fixture();f.open('opus');await settle();const stream=f.stream();f.requests[0].resolve(stream);await settle();const encoder=f.encoders[0];encoder.state='closed';assert.doesNotThrow(()=>encoder.callbacks.error(new Error('encoder failure')));assert.equal(stream.track.stopped,true);assert.equal(f.contexts[0].state,'closed');assert.equal(f.messages.length,1);encoder.callbacks.output({byteLength:1,duration:20000,copyTo(){throw new Error('retired output must be ignored')}});encoder.callbacks.error(new Error('retired error'));assert.equal(f.messages.length,1);
});
