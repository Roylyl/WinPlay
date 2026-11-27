'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const { Duplex } = require('node:stream');
const plist = require('plist');
const { selectUsbIphone, prepareWiredIphone } = require('../src/wired/prepare.cjs');
const { listUsbIphones, chooseUsbIphone } = require('../src/wired/iphone-target.cjs');

const parent = (serial, product) => ({ parentInstance: 'USB\\VID_05AC&PID_1234\\' + serial, product });
const note = (serial, id, type = 'USB') => ({ MessageType: 'Attached', DeviceID: id,
  Properties: { SerialNumber: serial, ConnectionType: type, ProductID: 0x1234 } });
const phone = parent('1234-ABCD', 'iPhone'), tablet = parent('AABB', 'iPad');

test('USB dropdown lists both iPhones and explicit selection takes priority over the last successful phone', async () => {
  const phones=await listUsbIphones({parents:()=>[phone,parent('ABCD-4321','iPhone')],
    attached:()=>[note('1234abcd',1),note('abcd4321',2)]});
  assert.equal(phones.length,2);
  assert.notEqual(phones[0].key,phones[1].key);
  assert.equal(chooseUsbIphone(phones,'',phones[1].key).DeviceID,2);
  assert.equal(chooseUsbIphone(phones,phones[0].key,phones[1].key).DeviceID,1);
  assert.throws(()=>chooseUsbIphone(phones,'missing',phones[1].key),{code:'USB_IPHONE_NOT_FOUND'});
});

test('one physical iPhone among iPad and network notifications; an explicit parent bypasses discovery', async () => {
  const device = await selectUsbIphone({parents: () => [phone, tablet],
    attached: () => [note('1234abcd',7,'Network'),note('1234abcd',9),note('AABB',3)],
    productType: () => assert.fail('bus product already identified')});
  assert.equal(device.DeviceID,9);
  assert.equal(device.parentInstance,phone.parentInstance);
  assert.deepEqual(await prepareWiredIphone(phone.parentInstance, true,
    () => assert.fail('unexpected discovery'), (...args) => args), [phone.parentInstance,true]);
});

test('multiple, unknown, uncorrelated and network-only devices require explicit selection', async () => {
  for(const [parents, attached] of [
    [[phone,parent('AA','iPhone')],[note('1234abcd',1),note('AA',2)]],
    [[parent('bb','Apple Mobile Device')],[note('bb',1)]],
    [[phone],[note('1234abcd',1,'Network')]],
    [[phone],[note('abcd',1)]],
    [[phone],[{...note('1234abcd',1),Properties:{...note('1234abcd',1).Properties,ProductID:0x8888}}]],
    [[phone],[{...note('1234abcd',1),Properties:{...note('1234abcd',1).Properties,ProductType:'iPad15,1'}}]],
  ]) {
    await assert.rejects(selectUsbIphone({parents:()=>parents,attached:()=>attached,productType:()=>null}),/--parent-instance/);
  }
  await assert.rejects(selectUsbIphone({parents:()=>[tablet], attached:()=>assert.fail('no phone')}),/No USB iPhone/);
});

test('unlabelled Apple USB product is identified via a single unpaired ProductType lookup over the matching USBMUX connection', async t => {
  const messages = [];
  function response(message, mux = true) {
    const body=Buffer.from(plist.build(message)), header=Buffer.alloc(mux?16:4);
    if(mux) [body.length+16,1,8,1].forEach((v,i)=>header.writeUInt32LE(v,i*4));
    else header.writeUInt32BE(body.length);
    return Buffer.concat([header,body]);
  }
  t.mock.method(net,'connect',(port,address)=>{
    assert.deepEqual([port,address],[27015,'127.0.0.1']);
    return new Duplex({read(){}, write(data,_encoding,cb){
      const isMux=data.readUInt32LE(4)===1;
      const request=plist.parse(data.subarray(isMux?16:4).toString());
      messages.push(request.MessageType || request.Request);
      let replies;
      if(request.MessageType==='Listen') replies=Buffer.concat([response({MessageType:'Result',Number:0}),
        response(note('1234ABCD',22,'Network')),response(note('1234ABCD',5))]);
      else if(request.MessageType==='Connect'){
        assert.equal(request.DeviceID,5);
        const bytes=Buffer.alloc(2); bytes.writeUInt16LE(request.PortNumber);
        assert.equal(bytes.readUInt16BE(),62078);
        replies=response({MessageType:'Result',Number:0});
      }else{
        assert.deepEqual(request,{Label:'WinPlay',Request:'GetValue',Key:'ProductType'});
        replies=response({Request:'GetValue',Value:'iPhone18,2'},false);
      }
      this.push(replies.subarray(0,7)); this.push(replies.subarray(7)); cb();
    }});
  });
  assert.equal((await selectUsbIphone({parents:()=>[parent('1234-ABCD','Apple Mobile Device')]})).DeviceID,5);
  assert.deepEqual(messages,['Listen','Connect','GetValue']);
});
