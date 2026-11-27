const test=require('node:test'),assert=require('node:assert/strict');
const {createCurrentNetworkReader}=require('../src/wlan-reader.cjs');
const {parseHotspotConfiguration}=require('../src/mobile-hotspot-reader.cjs');
const hotspotSnapshot={sharingAvailable:false,tetheringState:'On',items:[{name:'Current hotspot',hotspot:true,virtualHotspot:true,downstreamReady:true,activeHotspot:true,hotspotSource:'winrt'}],recommended:{hotspot:'Current hotspot'}};

test('current hotspot credentials come only from the Windows hotspot configuration, never netsh profiles',async()=>{
 let wlanCalls=0;
 const read=createCurrentNetworkReader({hotspot:async()=>({ok:true,ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',state:'On'}),wlan:async()=>{wlanCalls++;throw Error('upstream credentials must not be read')},networks:async()=>hotspotSnapshot});
 const result=await read('hotspot',{interfaceName:'Outdated adapter'});
 assert.equal(result.ok,true);assert.equal(result.mode,'hotspot');assert.equal(result.ssid,'PUBLIC-HOTSPOT');assert.equal(result.password,'public-hotspot-only');assert.equal(result.passwordRead,true);
 assert.equal(result.interfaceName,'Current hotspot');assert.equal(result.channel,0);assert.equal(result.channelKnown,false);assert.equal(result.bssid,undefined);assert.equal(wlanCalls,0);
 assert.equal(result.hotspotState,'On');
});

test('hotspot configuration stays readable while Off and partial failures do not erase a saved password',async()=>{
 const read=createCurrentNetworkReader({hotspot:async()=>({ok:true,ssid:'PUBLIC-HOTSPOT',state:'Off'}),networks:async()=>({items:[],tetheringState:'Off',sharingAvailable:true})});
 const result=await read('hotspot');
 assert.equal(result.ok,true);assert.equal(result.passwordRead,false);assert.equal('password' in result,false);assert.equal('interfaceName' in result,false);
 assert.match(result.warning,/尚未开启/);assert.match(result.warning,/手动填写/);
 assert.equal(result.hotspotState,'Off');
 const parsed=parseHotspotConfiguration(JSON.stringify({ok:true,ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',state:'Off'}));
 assert.equal(parsed.ok,true);assert.equal(parsed.state,'Off');assert.equal(parsed.password,'public-hotspot-only');
});

test('LAN reads credentials on the selected interface in the same snapshot',async()=>{
 const calls=[];
 const read=createCurrentNetworkReader({wlan:async options=>{
  calls.push(options);
  return {ok:true,ssid:'家庭网络',interfaceName:'Wi-Fi 2',channel:44,bssid:'02:ab:00:00:00:04',password:'public-lan-only'};
 },networks:async()=>{throw Error('LAN must not inspect hotspot configuration')}});
 const result=await read('lan',{interfaceName:'Wi-Fi 2'});
 assert.deepEqual(calls,[{interfaceName:'Wi-Fi 2',includePassword:true}]);
 assert.deepEqual(result,{ok:true,mode:'lan',ssid:'家庭网络',passwordRead:true,interfaceName:'Wi-Fi 2',channel:44,bssid:'02:AB:00:00:00:04',password:'public-lan-only'});
});

test('LAN metadata success with a password failure returns a partial result without credentials',async()=>{
 const read=createCurrentNetworkReader({wlan:async()=>({ok:true,ssid:'PUBLIC-LAN',interfaceName:'Wi-Fi',channel:0})});
 const result=await read('lan');
 assert.equal(result.ok,true);assert.equal(result.passwordRead,false);assert.equal('password' in result,false);assert.equal('channel' in result,false);
 assert.match(result.warning,/已保存密码/);
});

test('configuration failures sanitize error text and never return an empty credential replacement',async()=>{
 const hotspot=createCurrentNetworkReader({hotspot:async()=>{throw Error('private-fixture')}});
 assert.deepEqual(await hotspot('hotspot'),{ok:false,mode:'hotspot',error:'无法读取Windows移动热点配置，请在系统设置中核对热点名称和密码',passwordRead:false});
 const lan=createCurrentNetworkReader({wlan:async()=>({ok:false,error:'private-fixture',code:5})});
 const result=await lan('lan');assert.equal(result.ok,false);assert.equal(result.code,5);assert.equal(JSON.stringify(result).includes('private-fixture'),false);
 const invalid=parseHotspotConfiguration(JSON.stringify({ok:false,code:'private-fixture',password:'private-fixture'}));
 assert.equal(invalid.code,'HOTSPOT_CONFIGURATION_UNAVAILABLE');assert.equal(JSON.stringify(invalid).includes('private-fixture'),false);
});

test('a network metadata failure does not discard successfully read hotspot credentials',async()=>{
 const read=createCurrentNetworkReader({hotspot:async()=>({ok:true,ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',state:'On'}),networks:async()=>{throw Error('private-fixture')}});
 const result=await read('hotspot');assert.equal(result.ok,true);assert.equal(result.passwordRead,true);assert.equal('interfaceName' in result,false);assert.match(result.warning,/共享网卡/);
});

test('provided confirmed network snapshots avoid another OS enumeration; requested modes cannot mix',async()=>{
 let enumerations=0,reads=0;
 const read=createCurrentNetworkReader({hotspot:async()=>{reads++;return {ok:true,ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',state:'On'}},networks:async()=>{enumerations++;return hotspotSnapshot}});
 assert.equal((await read('hotspot',{snapshot:hotspotSnapshot})).interfaceName,'Current hotspot');assert.equal(enumerations,0);
 assert.equal((await read('invalid')).ok,false);assert.equal(reads,1);
});

test('an observed active hotspot cannot be replaced with historical Off or transition credentials',()=>{
 for(const state of ['Off','InTransition','Unknown']){
  const result=parseHotspotConfiguration(JSON.stringify({ok:true,activeSeen:true,state,ssid:'PUBLIC-HISTORICAL-HOTSPOT',password:'public-old-profile'}));
  assert.equal(result.ok,false);assert.equal('ssid' in result,false);assert.equal('password' in result,false);
 }
 assert.equal(parseHotspotConfiguration(JSON.stringify({ok:true,activeSeen:true,state:'On',ssid:'PUBLIC-ACTIVE-HOTSPOT',password:'public-current-profile'})).ssid,'PUBLIC-ACTIVE-HOTSPOT');
 assert.equal(parseHotspotConfiguration(JSON.stringify({ok:true,activeSeen:false,state:'Off',ssid:'PUBLIC-SAVED-HOTSPOT',password:'public-saved-profile'})).ok,true);
});
