const test=require('node:test'),assert=require('node:assert/strict');const {parseResult}=require('../src/wlan-reader.cjs');
test('SSID, channel and password results remain separate and Unicode-safe',()=>{assert.deepEqual(parseResult('read-network',Buffer.from('    SSID : 公共测试网络\r\n    Channel : 36'),null),{ok:true,ssid:'公共测试网络',channel:36,bssid:undefined});assert.deepEqual(parseResult('read-password',Buffer.from('Key Content : public-fixture'),null),{ok:true,password:'public-fixture'})});
test('system failure reports actual code without dumping profile secrets',()=>{const r=parseResult('read-password',Buffer.from('Key Content : private-fixture\nAccess is denied.'),{code:5});assert.equal(r.ok,false);assert(r.error.includes('5'));assert(r.error.includes('denied'));assert(!r.error.includes('private-fixture'))});
test('current Wi-Fi values come from one live interface after a disconnected adapter',()=>{
 const value=parseResult('read-network',Buffer.from('Name : Offline\nState : disconnected\nSSID :\n\nName : Wi-Fi 2\nState : connected\nSSID : Public Test\nBSSID : 02:00:00:00:00:02\nChannel : 44'),null);
 assert.deepEqual(value,{ok:true,ssid:'Public Test',channel:44,bssid:'02:00:00:00:00:02',interfaceName:'Wi-Fi 2'});
});
test('Chinese interface names and empty network fields cannot bleed across adapter blocks',()=>{
 const value=parseResult('read-network',Buffer.from('名称 : 网卡甲\n状态 : 已断开\nSSID :\n频道 :\n名称 : 网卡乙\n状态 : 已连接\nSSID : 公共测试\nBSSID : 02:00:00:00:00:04\n频道 : 36'),null);
 assert.equal(value.interfaceName,'网卡乙');assert.equal(value.ssid,'公共测试');assert.equal(value.channel,36);assert.equal(value.bssid,'02:00:00:00:00:04');
});
test('start-up reading can target one exact selected Wi-Fi interface without falling back to another',()=>{
 const output=Buffer.from('Name : Wi-Fi 1\nState : connected\nSSID : Public first\nBSSID : 02:00:00:00:00:02\nChannel : 36\nName : Wi-Fi 2\nState : connected\nSSID : Public second\nBSSID : 02:00:00:00:00:04\nChannel : 44');
 const result=parseResult('read-network',output,null,{interfaceName:'wi-fi 2'});
 assert.equal(result.interfaceName,'Wi-Fi 2');assert.equal(result.ssid,'Public second');assert.equal(result.channel,44);assert.equal(result.bssid,'02:00:00:00:00:04');
 assert.equal(parseResult('read-network',output,null,{interfaceName:'Ethernet'}).ok,false);
});
