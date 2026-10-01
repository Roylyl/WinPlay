const test=require('node:test'),assert=require('node:assert/strict');
const {resolveConnectionSettings}=require('../src/connection-settings.cjs');
const {accessPointIdentifier}=require('../build/engine/networkMode');
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
