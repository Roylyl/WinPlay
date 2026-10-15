const test=require('node:test'),assert=require('node:assert/strict');
const {networkSnapshot,networkGuidance,resolveNetworkSelection}=require('../src/network-selection.cjs');
const address=(value='192.168.1.10')=>({family:'IPv4',address:value});
const adapter=(name,changes={})=>({name,description:'Ethernet Adapter',physical:true,up:true,wireless:false,defaultRoute:true,routeMetric:10,...changes});
function lanSnapshot(){
 return networkSnapshot({Ethernet:[address()],WiFi:[address('192.168.2.10')],VPN:[address('10.0.0.1')],Down:[]},
  {adapters:[adapter('Ethernet'),adapter('WiFi',{description:'Wireless Adapter',wireless:true,routeMetric:30}),adapter('VPN',{description:'WireGuard Tunnel'}),adapter('Down',{up:false})]});
}

test('LAN guidance agrees with reception and offers only relevant physical adapters',()=>{
 const state=lanSnapshot(),auto=networkGuidance('lan','',state),explicit=networkGuidance('lan','Ethernet',state);
 assert.deepEqual(auto.selection,{ok:true,automatic:true,code:'LAN_CONFIRMED',name:'WiFi',kind:'wifi',selectionReplaced:false});
 assert.equal(auto.selection.name,resolveNetworkSelection('lan','',state).name);
 assert.deepEqual(auto.choices.map(item=>item.name),['WiFi','Ethernet','Down']);
 assert.equal(auto.choices[0].recommended,true);
 assert.equal(auto.choices[2].ready,false);
 assert.equal(explicit.selection.automatic,false);assert.equal(explicit.selection.kind,'ethernet');
 assert.equal(explicit.selection.name,resolveNetworkSelection('lan','Ethernet',state).name);
 assert.equal(explicit.choices[0].name,'Ethernet');
});

test('offline explicit LAN choices are retained without claiming connection or changing selection',()=>{
 const state=lanSnapshot(),offline=networkGuidance('lan','Down',state),missing=networkGuidance('lan','Absent',state);
 assert.equal(offline.selection.ok,false);assert.equal(offline.selection.name,'Down');assert.equal(offline.selection.automatic,false);
 assert.equal(offline.choices[0].name,'Down');assert.equal(offline.choices[0].ready,false);
 assert.equal(missing.selection.ok,false);assert.equal(missing.selection.name,undefined);assert.equal(missing.selection.kind,undefined);
 assert.equal(networkGuidance('lan','VPN',state).choices.some(item=>item.name==='VPN'),false);
});

test('a routed Ethernet interface outranks link-local-only Wi-Fi and IPv6 does not break a route tie',()=>{
 const state=networkSnapshot({Ethernet:[address()],WiFi:[{family:'IPv6',address:'fe80::1'}]},
  {adapters:[adapter('Ethernet'),adapter('WiFi',{wireless:true,defaultRoute:false,routeMetric:1})]});
 assert.equal(networkGuidance('lan','',state).selection.name,'Ethernet');
 const tied=networkSnapshot({'A wired':[address()],'B wired':[address('192.168.2.10'),{family:'IPv6',address:'fe80::2'}]},
  {adapters:[adapter('B wired'),adapter('A wired')]});
 assert.equal(networkGuidance('lan','',tied).selection.name,'A wired');
});

function hotspotSnapshot(state='On',privateNames=['Current hotspot']){
 return networkSnapshot({WiFi:[address()], 'Current hotspot':[address('192.168.137.1')],'Old hotspot':[address('192.168.173.1')],VPN:[address('10.0.0.1')]},
  {adapters:[adapter('WiFi',{wireless:true}),adapter('Current hotspot',{physical:false,description:'Microsoft Wi-Fi Direct Virtual Adapter',defaultRoute:false}),adapter('Old hotspot',{physical:false,description:'Microsoft Wi-Fi Direct Virtual Adapter #2',defaultRoute:false}),adapter('VPN',{description:'VPN Tunnel'})],
   privateNames,publicNames:['WiFi'],sharingAvailable:true,tetheringStates:[state]});
}

test('hotspot guidance identifies only the confirmed downstream and records replacement of an old alias',()=>{
 const state=hotspotSnapshot(),result=networkGuidance('hotspot','Old hotspot',state);
 assert.deepEqual(result.selection,{ok:true,automatic:false,code:'HOTSPOT_CONFIRMED',name:'Current hotspot',kind:'hotspot',selectionReplaced:true});
 assert.deepEqual(result.choices,[{name:'Current hotspot',kind:'hotspot',ready:true,selected:true,recommended:true},{name:'Old hotspot',kind:'hotspot',ready:false,selected:false,recommended:false}]);
 assert.equal(result.selection.name,resolveNetworkSelection('hotspot','Old hotspot',state).name);
});

test('off or ambiguous hotspot state never claims that a retained IP is ready',()=>{
 for(const [state,privateNames,code] of [['Off',['Current hotspot'],'HOTSPOT_OFF'],['On',[],'HOTSPOT_INTERFACE_AMBIGUOUS']]){
  const result=networkGuidance('hotspot','',hotspotSnapshot(state,privateNames));
  assert.equal(result.selection.ok,false);assert.equal(result.selection.code,code);assert.equal(result.selection.kind,'hotspot');
  assert.equal(result.selection.name,undefined);assert.equal(result.choices.some(item=>item.ready||item.recommended||item.selected),false);
 }
});

test('query failure and empty LAN snapshots never advertise a connected network',()=>{
 const failed=networkGuidance('lan','Ethernet',{...lanSnapshot(),queryFailed:true});
 assert.equal(failed.selection.code,'NETWORK_QUERY_FAILED');assert.equal(failed.selection.ok,false);
 assert.equal(failed.choices.some(item=>item.ready||item.recommended),false);
 const empty=networkGuidance('lan','',networkSnapshot({},{}));
 assert.equal(empty.selection.code,'LAN_NOT_READY');assert.equal(empty.selection.kind,undefined);assert.deepEqual(empty.choices,[]);
});

test('an unrelated virtual or VPN interface with an old ICS role is neither offered nor confirmed as the hotspot',()=>{
 for(const description of ['VPN Tunnel','Tailscale','Hyper-V Virtual Ethernet Adapter','VMware Virtual Ethernet Adapter']){
  const state=networkSnapshot({'Old shared interface':[address('10.0.0.1')]},{adapters:[adapter('Old shared interface',{physical:false,description,defaultRoute:false})],privateNames:['Old shared interface'],tetheringStates:['On'],sharingAvailable:true});
  const result=networkGuidance('hotspot','',state);
  assert.equal(result.selection.ok,false,description);assert.deepEqual(result.choices,[],description);
 }
});
