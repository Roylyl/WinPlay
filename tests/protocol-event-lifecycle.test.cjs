const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {once}=require('node:events');
const {CpStack}=require('../build/engine/protocol/cpStack');
const {ControlCipher}=require('../build/engine/protocol/controlCipher');
const {hkdfSha512}=require('../build/engine/protocol/crypto');

async function events(t){
 const stack=new CpStack({mfi:{}}),shared=Buffer.alloc(32,7);
 const session={pairVerify:{sharedSecret:shared},audioMeta:[],pendingEvents:[],recordResponseSent:true,eventCseq:0};
 const port=await stack._openEventChannel(session),clients=[];
 t.after(()=>{for(const client of clients)client.destroy();stack._teardown(session);stack.stop()});
 async function connect(){const accepted=once(stack,'protocol-state');const client=net.connect(port,'127.0.0.1');clients.push(client);await accepted;return client}
 return {stack,session,shared,connect};
}

test('session teardown destroys the accepted event socket and clears HID routing',async t=>{
 const h=await events(t),client=await h.connect(),closed=once(client,'close');
 assert.equal(h.stack._active,h.session);
 h.stack._teardown(h.session);await closed;
 assert.equal(h.session.eventSock,null);assert.equal(h.session.eventCipher,null);assert.equal(h.stack._active,null);
});

test('event reconnection retires the old socket without clearing the replacement',async t=>{
 const h=await events(t),first=await h.connect(),retired=once(first,'close');
 const old=h.session.eventSock,second=await h.connect(),current=h.session.eventSock;
 assert.notEqual(current,old);await retired;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.session.eventSock,current);assert.equal(h.stack._active,h.session);assert(!second.destroyed);
 const received=once(second,'data');h.stack.sendMedia(1);const [data]=await received;assert(data.length>0);
});

test('malformed authenticated event framing closes only that event connection',async t=>{
 const h=await events(t),client=await h.connect(),closed=once(client,'close');
 const key=hkdfSha512(h.shared,'Events-Salt','Events-Read-Encryption-Key',32);
 const cipher=new ControlCipher(key,key);
 client.write(cipher.encrypt(Buffer.from('POST /command RTSP/1.0\r\nContent-Length: -1\r\n\r\n')));
 await closed;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.session.eventSock,null);
 const replacement=await h.connect();assert(!replacement.destroyed);assert.equal(h.stack._active,h.session);
});
