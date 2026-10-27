const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {Accessory,param}=require('../build/engine/iap');
const cfg={ssid:'PUBLIC-LAN',password:'public-password',channel:6,btMac:'02:00:00:00:00:01',apMac:'02:00:00:00:00:02',host:'192.0.2.1',port:17000,pk:'public-key',serial:'PUBLIC'};
const offer=value=>new Map([[1,param(0,Buffer.from([value]))]]);
function fixture(options={},signer={}){
 class Link extends EventEmitter{sent=[];send(frame){this.sent.push(frame)}close(){this.closed=true}}
 const link=new Link(),accessory=new Accessory(link,signer,cfg,options),failures=[];
 accessory.on('failed',message=>failures.push(message));
 return {link,accessory,failures,receive:(id,p=new Map())=>link.emit('csm',id,p),authenticate:()=>{link.emit('csm',0x1d02,new Map());link.emit('csm',0xaa05,new Map())},starts:()=>link.sent.filter(frame=>frame.readUInt16BE(4)===0x4301)};
}
test('wireless availability must explicitly be true and cannot start before authentication',async t=>{
 const f=fixture();t.after(()=>f.accessory.close());f.receive(0x4300,offer(1));assert.equal(f.starts().length,0);f.authenticate();
 for(const p of [new Map(),new Map([[0,param(0,Buffer.from([1]))]]),offer(0),offer(2),new Map([[1,Buffer.from([0,3,0,0])]]),new Map([[1,param(0,Buffer.from([1,1]))]])])f.receive(0x4300,p);
 assert.equal(f.starts().length,0);assert.equal(f.failures.length,0);f.receive(0x4300,offer(1));assert.equal(f.starts().length,1);
});
test('duplicate availability never restarts a session; explicit retries still require current availability',async t=>{
 const f=fixture();t.after(()=>f.accessory.close());f.authenticate();f.receive(0x4300,offer(1));f.receive(0x4300,offer(1));await f.accessory.startCarPlay();assert.equal(f.starts().length,1);
 assert.equal(await f.accessory.startCarPlay(true),true);assert.equal(f.starts().length,2);
 f.receive(0x4300,offer(0));assert.equal(await f.accessory.startCarPlay(true),false);f.receive(0x4300,offer(1));assert.equal(f.starts().length,2);
});
test('network iAP2 relay keeps media updates without ever bootstrapping a second CarPlay session',async t=>{
 const f=fixture({bootstrap:false});t.after(()=>f.accessory.close());let updates=0;f.accessory.on('now-playing',()=>updates++);f.authenticate();
 f.receive(0x4300,offer(0));f.receive(0x4300,offer(1));f.receive(0x4300,offer(1));assert.equal(await f.accessory.startCarPlay(true),false);
 f.receive(0x5001);assert.equal(updates,1);assert.equal(f.starts().length,0);assert.ok(f.link.sent.some(frame=>frame.readUInt16BE(4)===0x5000));
});
test('confirmed handoff prevents initial and explicit Bluetooth retries',async t=>{
 let connected=false;const f=fixture({canStart:()=>!connected});t.after(()=>f.accessory.close());f.authenticate();f.receive(0x4300,offer(1));connected=true;
 assert.equal(await f.accessory.startCarPlay(true),false);f.receive(0x4300,offer(1));assert.equal(f.starts().length,1);
 const second=fixture({canStart:()=>false});t.after(()=>second.accessory.close());second.authenticate();second.receive(0x4300,offer(1));assert.equal(second.starts().length,0);
});
test('transport closure cancels the accessory deadline and ignores late authentication work',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),f=fixture({}, {certificate:()=>pending});
 f.receive(0x1d02);f.receive(0xaa00);f.link.emit('transport-closed');const count=f.link.sent.length;resolve(Buffer.from([1,2,3]));await new Promise(done=>setImmediate(done));
 assert.equal(f.link.closed,true);assert.equal(f.accessory.deadline._destroyed,true);assert.equal(f.link.sent.length,count);assert.equal(f.failures.length,0);f.accessory.close();
});
