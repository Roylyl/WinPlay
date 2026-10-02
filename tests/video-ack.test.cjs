const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('video acknowledgments wait for receiver consumption then echo identity and decoder state',()=>{
 const calls=[],decoded=[];let receive,api;class Receiver{constructor(options){api=options}decode(message){decoded.push(message)}}
 const context={WinPlayVideoReceiver:Receiver,VideoDecoder:class{},EncodedVideoChunk:class{},winplay:{on:callback=>receive=callback,input:message=>calls.push(message)}};
 const source=fs.readFileSync(require.resolve('../src/ui/video.js'),'utf8'),receiver=source.match(/^const receiver=new WinPlayVideoReceiver\(\{[^\n]+\}\);/m),handler=source.match(/^winplay.on\(m=>\{[^\n]+\}\);/m);assert.ok(receiver&&handler);vm.runInNewContext(receiver[0]+'\n'+handler[0],context);
 const frame={type:'video-frame',frameId:8,generation:2,reset:true,data:[0,0,0,1,5],timestamp:10};receive(frame);assert.equal(decoded[0],frame);assert.equal(calls.length,0);api.ack(frame,{decoderQueueSize:4,ready:true,awaitKey:false});assert.equal(calls[0].command,'video-ack');assert.equal(calls[0].frameId,8);assert.equal(calls[0].generation,2);assert.equal(calls[0].decoderQueueSize,4);assert.equal(calls[0].ready,true);assert.equal(calls[0].awaitKey,false);
});
