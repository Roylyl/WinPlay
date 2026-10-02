const test=require('node:test'),assert=require('node:assert/strict');
const {resolveConnectionSettings,refreshLanParameters}=require('../src/connection-settings.cjs');
const {accessPointIdentifier,receiverNetwork}=require('../build/engine/networkMode');
test('wireless mode resolves its own credentials and interface without cross-profile mixing',()=>{
 const saved={wirelessMode:'hotspot',ssid:'PUBLIC-HOTSPOT',password:'public-hotspot-only',channel:36,networkInterface:'hotspot',lanSsid:'PUBLIC-LAN',lanPassword:'public-lan-only',lanChannel:6,lanNetworkInterface:'wifi',lanAccessPointMac:'02:00:00:00:00:04'};
 const hotspot=resolveConnectionSettings(saved);assert.equal(hotspot.ssid,'PUBLIC-HOTSPOT');assert.equal(hotspot.networkInterface,'hotspot');assert.equal(hotspot.accessPointMac,'');
 const lan=resolveConnectionSettings({...saved,wirelessMode:'lan'});assert.equal(lan.ssid,'PUBLIC-LAN');assert.equal(lan.password,'public-lan-only');assert.equal(lan.channel,6);assert.equal(lan.networkInterface,'wifi');assert.equal(saved.ssid,'PUBLIC-HOTSPOT');
 assert.throws(()=>resolveConnectionSettings({...saved,wirelessMode:'invalid'}));
});
test('LAN handoff uses supplied router BSSID; local hotspot uses its actual NIC',()=>{
 const nic='02:00:00:00:00:02',router='02:00:00:00:00:04';assert.equal(accessPointIdentifier({wirelessMode:'lan',accessPointMac:router},nic),router);
 assert.equal(accessPointIdentifier({wirelessMode:'hotspot',accessPointMac:router},nic),nic);assert.equal(accessPointIdentifier({wirelessMode:'lan'},nic),nic);assert.throws(()=>accessPointIdentifier({wirelessMode:'lan',accessPointMac:'bad'},nic));
});
test('LAN start refreshes only matching current radio parameters without mutating saved credentials',()=>{
 const cfg={wirelessMode:'lan',ssid:'Public network',password:'public-password',channel:6,networkInterface:'Wi-Fi',accessPointMac:'02:00:00:00:00:02'};
 const refreshed=refreshLanParameters(cfg,{ok:true,ssid:'Public network',interfaceName:'wi-fi',channel:44,bssid:'02:ab:00:00:00:04'});
 assert.equal(refreshed.channel,44);assert.equal(refreshed.accessPointMac,'02:AB:00:00:00:04');assert.equal(refreshed.ssid,cfg.ssid);assert.equal(refreshed.password,cfg.password);
 assert.equal(cfg.channel,6);assert.equal(cfg.accessPointMac,'02:00:00:00:00:02');
 for(const current of [{ok:false},{ok:true,ssid:'Other public network',interfaceName:'Wi-Fi',channel:44,bssid:'02:00:00:00:00:04'},{ok:true,ssid:'Public network',interfaceName:'Wi-Fi 2',channel:44,bssid:'02:00:00:00:00:04'}])assert.deepEqual(refreshLanParameters(cfg,current),cfg);
 assert.deepEqual(refreshLanParameters({...cfg,wirelessMode:'hotspot'},{ok:true,ssid:cfg.ssid,interfaceName:'Wi-Fi',channel:44,bssid:'02:00:00:00:00:04'}),{...cfg,wirelessMode:'hotspot'});
 const invalid=refreshLanParameters(cfg,{ok:true,ssid:cfg.ssid,interfaceName:'Wi-Fi',channel:999,bssid:'00:00:00:00:00:00'});assert.deepEqual(invalid,cfg);
});

const address=(family,ip,extra={})=>({family,address:ip,internal:false,mac:'02:ab:00:00:00:02',...extra});

test('receiverNetwork prefers IPv4 and retains scoped IPv6 as a same-interface alternate',()=>{
 const addresses=[address('IPv6','fe80::2%17',{scopeid:17}),address('IPv4','192.0.2.2',{netmask:'255.255.255.0'})];
 const result=receiverNetwork(addresses);
 assert.deepEqual(result,{host:'192.0.2.2',family:'IPv4',mac:'02:AB:00:00:00:02',scope:17,alternateHost:'fe80::2',alternateFamily:'IPv6'});
 assert.equal(addresses[0].address,'fe80::2%17');
});

test('receiverNetwork excludes invalid, internal, link-local and broadcast IPv4 addresses',()=>{
 const invalid=[
  address('IPv4','0.1.2.3'),address('IPv4','127.0.0.1'),address('IPv4','169.254.2.3'),
  address('IPv4','255.255.255.255'),address('IPv4','224.0.0.1'),address('IPv4','300.2.3.4'),
  address('IPv4','192.0.2.2',{internal:true}),address('IPv4','192.0.2.255',{netmask:'255.255.255.0'})
 ];
 assert.throws(()=>receiverNetwork(invalid),/没有可用地址/);
 assert.equal(receiverNetwork([...invalid,address(4,'192.0.2.3')]).host,'192.0.2.3');
 // A host ending in 255 can be valid on a wider subnet or a point-to-point link.
 assert.equal(receiverNetwork([address('IPv4','192.0.2.255',{netmask:'255.255.254.0'})]).host,'192.0.2.255');
 assert.equal(receiverNetwork([address('IPv4','192.0.2.255',{netmask:'255.255.255.254'})]).host,'192.0.2.255');
});

test('receiverNetwork accepts scoped link-local IPv6-only interfaces without sending the zone',()=>{
 assert.deepEqual(receiverNetwork([address('IPv6','fe80::2%17')]),{host:'fe80::2',family:'IPv6',mac:'02:AB:00:00:00:02',scope:17});
 assert.equal(receiverNetwork([address(6,'febf::2',{scopeid:18})]).scope,18);
 assert.equal(receiverNetwork([address('IPv6','fe80::2%17',{scopeid:18})]).scope,18);
});

test('receiverNetwork ignores IPv6 without usable scope and never borrows a foreign interface scope',()=>{
 for(const candidate of [
  address('IPv6','fe80::2'),address('IPv6','fe80::2%0'),address('IPv6','fe80::2%name'),
  address('IPv6','fe80::2',{scopeid:-1}),address('IPv6','fe80::2',{scopeid:0x100000000}),
  address('IPv6','2001:db8::2',{scopeid:17}),address('IPv6','::1',{scopeid:17}),
  address('IPv6','fe80::2',{scopeid:17,internal:true})
 ])assert.throws(()=>receiverNetwork([candidate]),/没有可用地址/);
 const ipv4=address('IPv4','192.0.2.2');
 assert.deepEqual(receiverNetwork([ipv4,address('IPv6','fe80::2')]),{host:'192.0.2.2',family:'IPv4',mac:'02:AB:00:00:00:02',scope:undefined});
 assert.deepEqual(receiverNetwork([ipv4,address('IPv6','fe80::3%19',{mac:'02:00:00:00:00:03'})]),{host:'192.0.2.2',family:'IPv4',mac:'02:AB:00:00:00:02',scope:undefined});
});
