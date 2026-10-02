const test=require('node:test'),assert=require('node:assert/strict');
const {candidates,recommendNetworks,resolveNetworkSelection,createNetworkWaiter,summarizeTethering,networkSnapshot}=require('../src/network-selection.cjs');
const adapters=[{name:'WLAN',description:'Intel Wi-Fi',physical:true,up:true},{name:'Hotspot',description:'Microsoft Wi-Fi Direct Virtual Adapter',physical:false,up:true},{name:'Old hotspot',description:'Microsoft Wi-Fi Direct Virtual Adapter #2',physical:false,up:true},{name:'VPN',description:'VPN Tunnel',physical:true,up:true}];
const addresses={WLAN:[{family:'IPv4',address:'192.168.1.7'},{family:'IPv6',address:'fe80::1'}],Hotspot:[{family:'IPv4',address:'192.168.137.1'}],'Old hotspot':[{family:'IPv4',address:'192.168.173.1'}],VPN:[{family:'IPv4',address:'10.0.0.1'}]};
function snapshot(privateNames=[]){const items=candidates(addresses,adapters,privateNames,['WLAN']);return {items,sharingAvailable:true,recommended:{hotspot:items.find(n=>n.activeHotspot)?.name||'',lan:items.find(n=>n.lan&&n.ready)?.name||''}}}

test('a stale Wi-Fi Direct address never proves an active hotspot; ICS identifies the actual downstream',()=>{
 const pending=snapshot(),active=snapshot(['Hotspot']);
 assert.equal(pending.items.find(n=>n.name==='Hotspot').hotspot,true);
 assert.equal(pending.items.find(n=>n.name==='Hotspot').activeHotspot,false);
 assert.equal(active.items.find(n=>n.name==='Hotspot').activeHotspot,true);
 assert.equal(active.items.find(n=>n.name==='Old hotspot').activeHotspot,false);
 assert.equal(active.items.find(n=>n.name==='WLAN').sharingRole,'public');
 assert.equal(resolveNetworkSelection('hotspot','WLAN',active).name,'Hotspot');
 assert.equal(resolveNetworkSelection('hotspot','WLAN',active).diagnostic.selectionReplaced,true);
 assert.equal(resolveNetworkSelection('lan','WLAN',active).ok,true);
 assert.equal(resolveNetworkSelection('lan','VPN',active).ok,false);
 assert.equal(resolveNetworkSelection('hotspot','',active).name,'Hotspot');
});
test('a down or self-assigned downstream interface is listed but cannot start reception',()=>{
 for(const change of ['down','no-address','self-assigned']){
  const modified=adapters.map(a=>({...a,up:a.name==='Hotspot'&&change==='down'?false:a.up}));
  const changedAddresses={...addresses,Hotspot:change==='no-address'?[]:change==='self-assigned'?[{family:'IPv4',address:'169.254.1.2'}]:addresses.Hotspot};
  const item=candidates(changedAddresses,modified,['Hotspot']).find(n=>n.name==='Hotspot');
  assert.equal(item.activeHotspot,false,change);
 }
});
test('hotspot readiness waits until Windows confirms the shared interface, while LAN failures return directly',async()=>{
 let reads=0,waits=0;const wait=createNetworkWaiter(async()=>++reads===1?snapshot():snapshot(['Hotspot']),async()=>{});
 const result=await wait('hotspot','Hotspot',{onWait:()=>waits++});
 assert.equal(result.ok,true);assert.equal(reads,2);assert.equal(waits,1);
 reads=0;const lan=await wait('lan','VPN');assert.equal(lan.ok,false);assert.equal(reads,1);
});
test('stopping reception cancels a pending network check and unavailable sharing fails clearly',async()=>{
 const controller=new AbortController();let reads=0;
 const wait=createNetworkWaiter(async()=>{reads++;return {...snapshot(),sharingAvailable:false}},async()=>controller.abort());
 const result=await wait('hotspot','Hotspot',{signal:controller.signal});
 assert.equal(result.code,'NETWORK_WAIT_CANCELLED');assert.equal(reads,1);
 assert.equal(resolveNetworkSelection('hotspot','Hotspot',{...snapshot(),sharingAvailable:false}).code,'HOTSPOT_SHARING_UNAVAILABLE');
});
test('automatic LAN chooses connected Wi-Fi ahead of enumeration order while retaining an explicit Ethernet choice',()=>{
 const items=candidates({Ethernet:[{family:'IPv6',address:'fe80::1'},{family:'IPv4',address:'192.168.5.2'}],WiFi:[{family:'IPv6',address:'fe80::2'},{family:'IPv4',address:'192.168.6.2'}]},[
  {name:'Ethernet',description:'Ethernet Adapter',physical:true,up:true,wireless:false,defaultRoute:true,routeMetric:5},
  {name:'WiFi',description:'Native wireless adapter',physical:true,up:true,wireless:true,defaultRoute:true,routeMetric:30}
 ]);
 const state={items,recommended:recommendNetworks(items)};
 assert.equal(state.recommended.lan,'WiFi');assert.equal(resolveNetworkSelection('lan','',state).name,'WiFi');
 assert.equal(resolveNetworkSelection('lan','Ethernet',state).name,'Ethernet');
});
test('automatic LAN ranks valid routes within one transport and never recommends VPN or disconnected adapters',()=>{
 const ready=(name,routeMetric,defaultRoute=true)=>({name,description:'Ethernet Adapter',physical:true,up:true,wireless:false,defaultRoute,routeMetric});
 const metadata=[ready('No route',1,false),ready('Slow route',60),ready('Fast route',10),{...ready('VPN',0),description:'WireGuard Tunnel'},{...ready('Down',0),up:false}];
 const addresses=Object.fromEntries(metadata.map((a,i)=>[a.name,[{family:'IPv4',address:'192.168.'+(i+1)+'.2'}]]));
 assert.equal(recommendNetworks(candidates(addresses,metadata)).lan,'Fast route');
});

const modernSnapshot=(states,overrides={})=>networkSnapshot(addresses,{adapters,sharingAvailable:true,privateNames:[],publicNames:['WLAN'],tetheringStates:states,...overrides});

test('WinRT state aggregation prioritizes On and never treats unread profiles as Off',()=>{
 assert.equal(summarizeTethering(['Off','On'],1),'On');
 assert.equal(summarizeTethering(['Off','InTransition']),'InTransition');
 assert.equal(summarizeTethering(['Off','Off']),'Off');
 assert.equal(summarizeTethering(['Off'],1),'Unknown');
 assert.equal(summarizeTethering(['Off','Unknown']),'Unknown');
 assert.equal(summarizeTethering([],1),'unavailable');
 assert.equal(summarizeTethering([]),'unavailable');
});

test('modern hotspot On accepts one live Wi-Fi Direct downstream even when ICS omits its private role',()=>{
 const state=modernSnapshot(['On'],{adapters:adapters.filter(a=>a.name!=='Old hotspot'),sharingAvailable:false});
 const selected=resolveNetworkSelection('hotspot','',state);
 assert.equal(selected.ok,true);assert.equal(selected.name,'Hotspot');
 assert.equal(selected.diagnostic.state,'On');assert.equal(selected.diagnostic.source,'winrt');
 assert.equal(selected.diagnostic.activeCount,1);assert.equal(selected.diagnostic.sharingAvailable,false);
 assert.deepEqual(resolveNetworkSelection('hotspot','WLAN',state).diagnostic,{...selected.diagnostic,selectionReplaced:true});
 assert.equal(resolveNetworkSelection('hotspot','No longer present',state).name,'Hotspot');
});

test('Off and transition reject stale ICS roles; unavailable and partial WinRT queries retain explicit ICS evidence',()=>{
 for(const state of ['Off','InTransition']){
  const snapshot=modernSnapshot([state],{privateNames:['Hotspot']});
  const selected=resolveNetworkSelection('hotspot','Hotspot',snapshot);
  assert.equal(selected.ok,false);assert.equal(selected.diagnostic.activeCount,0);
  assert.equal(selected.code,state==='Off'?'HOTSPOT_OFF':'HOTSPOT_TRANSITION');
 }
 for(const options of [{tetheringStates:[],tetheringFailures:1},{tetheringStates:['Off'],tetheringFailures:1},{tetheringStates:['Unknown']}]){
  assert.equal(resolveNetworkSelection('hotspot','Hotspot',modernSnapshot([],{...options,privateNames:['Hotspot']})).ok,true);
  assert.equal(resolveNetworkSelection('hotspot','Hotspot',modernSnapshot([],{...options,privateNames:[]})).ok,false);
 }
});

test('multiple modern downstream candidates require a unique ICS private match, never a guessed saved alias',()=>{
 const ambiguous=modernSnapshot(['On']);
 assert.equal(resolveNetworkSelection('hotspot','Hotspot',ambiguous).code,'HOTSPOT_INTERFACE_AMBIGUOUS');
 assert.equal(ambiguous.recommended.hotspot,'');
 const explicit=modernSnapshot(['On'],{privateNames:['Hotspot']});
 assert.equal(resolveNetworkSelection('hotspot','Old hotspot',explicit).name,'Hotspot');
 assert.equal(resolveNetworkSelection('hotspot','Old hotspot',explicit).diagnostic.selectionReplaced,true);
 assert.equal(resolveNetworkSelection('hotspot','Hotspot',explicit).diagnostic.selectionReplaced,false);
 assert.equal(resolveNetworkSelection('hotspot','',modernSnapshot(['On'],{privateNames:['Hotspot','Old hotspot']})).ok,false);
});

test('modern hotspot does not use unknown link status, upstream routes, public roles, or unconfirmed physical interfaces',()=>{
 for(const changes of [{up:undefined},{up:false},{defaultRoute:true}]){
  const modified=adapters.filter(a=>a.name!=='Old hotspot').map(a=>a.name==='Hotspot'?{...a,...changes}:a);
  assert.equal(resolveNetworkSelection('hotspot','',modernSnapshot(['On'],{adapters:modified})).ok,false);
 }
 assert.equal(resolveNetworkSelection('hotspot','',modernSnapshot(['On'],{adapters:adapters.filter(a=>a.name!=='Old hotspot'),publicNames:['WLAN','Hotspot']})).ok,false);
 assert.equal(resolveNetworkSelection('hotspot','',modernSnapshot(['On'],{adapters:adapters.filter(a=>a.name==='WLAN'),privateNames:[],publicNames:[]})).ok,false);
 const explicitPhysical=resolveNetworkSelection('hotspot','',modernSnapshot(['On'],{adapters:adapters.filter(a=>a.name==='WLAN'),privateNames:['WLAN'],publicNames:[]}));
 assert.equal(explicitPhysical.ok,true);assert.equal(explicitPhysical.diagnostic.source,'ics');
 const unknownLan=candidates({WLAN:addresses.WLAN},[{...adapters[0],up:undefined}]);
 assert.equal(resolveNetworkSelection('lan','WLAN',{items:unknownLan,recommended:recommendNetworks(unknownLan)}).ok,false);
});

test('hotspot diagnostics contain only states, counters and codes on success and failure',()=>{
 for(const snapshot of [modernSnapshot(['On'],{privateNames:['Hotspot']}),modernSnapshot(['Off'])]){
  const selected=resolveNetworkSelection('hotspot','Old hotspot',snapshot),output=JSON.stringify(selected.diagnostic);
  for(const value of [...Object.keys(addresses),...Object.values(addresses).flat().map(a=>a.address)])assert.equal(output.includes(value),false,value);
  assert.equal(typeof selected.diagnostic.directCount,'number');
  assert.equal(typeof selected.diagnostic.activeCount,'number');
  assert.equal(typeof selected.diagnostic.reason,'string');
 }
});
