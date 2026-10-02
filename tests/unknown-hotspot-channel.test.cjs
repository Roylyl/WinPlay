const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Accessory,fields}=require('../build/engine/iap');

test('unknown hotspot channel zero stays zero in both iAP Wi-Fi configuration and CarPlay start payloads',async()=>{
 class Link extends EventEmitter{sent=[];send(value){this.sent.push(value)}close(){}}
 const link=new Link(),accessory=new Accessory(link,{}, {ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',channel:0,btMac:'02:00:00:00:00:01',apMac:'02:00:00:00:00:02',host:'192.0.2.2',port:17000,pk:'public-fixture',serial:'PUBLIC-FIXTURE'});
 try{
  link.emit('csm',0x1d02,new Map());link.emit('csm',0xaa05,new Map());
  link.emit('csm',0x5702,new Map());await accessory.startCarPlay();
  const wifi=link.sent.find(frame=>frame.readUInt16BE(4)===0x5703);
  const carplay=link.sent.find(frame=>frame.readUInt16BE(4)===0x4301);
  assert.ok(wifi);assert.ok(carplay);
  assert.deepEqual(fields(wifi.subarray(6)).get(4),Buffer.from([0]));
  assert.deepEqual(fields(fields(carplay.subarray(6)).get(1)).get(2),Buffer.from([0]));
 }finally{accessory.close()}
});
