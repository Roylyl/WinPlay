const test=require('node:test'),assert=require('node:assert/strict'),dgram=require('node:dgram');
const {CpStack}=require('../build/engine/protocol/cpStack');
const {hkdfSha512,chachaSeal}=require('../build/engine/protocol/crypto');

function fixture(t){
 const sessions=[],stacks=[],socket=dgram.createSocket('udp4');
 t.after(()=>{socket.close();for(const {stack,session} of sessions)for(const meta of session.audioMeta)stack._closeAudio(meta);for(const stack of stacks)stack.stop()});
 const create=()=>{const stack=new CpStack({mfi:{}});stacks.push(stack);return stack};
 async function open(stack,id,microphone=false){
  const session={pairVerify:{sharedSecret:Buffer.alloc(32,id)},audioMeta:[],peerHost:'127.0.0.1'};
  sessions.push({stack,session});
  const setup=await stack._setupAudio({streamConnectionID:id,audioType:microphone?'telephony':'media',audioFormat:microphone?0x40000000:0x800000,...(microphone?{dataPort:45001}:{})},session,microphone?100:102);
  return {stack,id,session,setup,meta:session.audioMeta[0]};
 }
 async function firstPacket(stream,sample){
  const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Audio owner did not receive its first packet')),1500);stream.stack.once('audio-active',(_profile,active)=>{clearTimeout(timer);active?resolve():reject(Error('Unexpected inactive audio'))})});
  const header=Buffer.alloc(12);header[0]=128;header.writeUInt32BE(sample,4);
  const nonce=Buffer.alloc(12),key=hkdfSha512(stream.session.pairVerify.sharedSecret,'DataStream-Salt'+stream.id,'DataStream-Output-Encryption-Key',32);
  const packet=Buffer.concat([header,chachaSeal(key,nonce,Buffer.from([1,2,3,4]),header.subarray(4)),nonce.subarray(4)]);
  socket.send(packet,stream.setup.dataPort,'127.0.0.1');await received;
 }
 return {create,open,firstPacket};
}

test('an extra unauthenticated control connection cannot steal a live stream media clock or microphone',async t=>{
 const f=fixture(t),owner=f.create(),stream=await f.open(owner,11,true);let micStarts=0;
 owner.on('mic-active',active=>{if(active)micStarts++});
 const extra=f.create();extra.stop();
 await f.firstPacket(stream,48000);
 assert.equal(stream.meta.origin.firstSample,48000);assert.notEqual(stream.meta.micStreamId,null);assert.equal(micStarts,1);
});

test('concurrent audio receivers dispatch their first samples to their own sessions regardless of arrival order',async t=>{
 const f=fixture(t),first=f.create(),a=await f.open(first,21),second=f.create(),b=await f.open(second,22);
 await f.firstPacket(b,96000);assert.equal(b.meta.origin.firstSample,96000);assert.equal(a.meta.origin,null);
 await f.firstPacket(a,24000);assert.equal(a.meta.origin.firstSample,24000);assert.equal(b.meta.origin.firstSample,96000);
});
