const test=require('node:test'), assert=require('node:assert/strict');
const {parseWlanConnection}=require('../src/wlan-reader.cjs');
const raw={ok:true,interfaceName:' 网卡乙 ',ssidHex:'20E4B8ADE696873A20',channel:36,bssid:'02:00:00:00:00:04',password:' 测试:密码 '};

test('raw DOT11_SSID octets and Unicode profile key preserve punctuation and whitespace',()=>{
 assert.deepEqual(parseWlanConnection(JSON.stringify(raw),true),{
  ok:true,interfaceName:raw.interfaceName,ssid:' 中文: ',channel:36,bssid:raw.bssid,password:raw.password
 });
 assert.equal('password' in parseWlanConnection(JSON.stringify(raw),false),false);
});

test('unreadable and invalid SSID bytes cannot overwrite or contradict manual configuration',()=>{
 for(const ssidHex of ['','F','ZZ','00','FFFE','61'.repeat(33)])
  assert.deepEqual(parseWlanConnection(JSON.stringify({...raw,ssidHex}),true),{ok:false});
 assert.deepEqual(parseWlanConnection(JSON.stringify({...raw,ok:false,code:5}),true),{ok:false,code:5});
 assert.deepEqual(parseWlanConnection('incomplete profile',true),{ok:false});
});

test('identifiers sharing a Unicode glyph remain distinct by exact UTF-8 including a leading BOM',()=>{
 const parse=hex=>parseWlanConnection(JSON.stringify({...raw,ssidHex:hex}),false).ssid;
 assert.notEqual(parse('C3A9'),parse('65CC81'));
 assert.notEqual(parse('EFBBBF41'),parse('41'));
});
