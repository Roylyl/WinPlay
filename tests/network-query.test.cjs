const test=require('node:test'),assert=require('node:assert/strict');
const {createMetadataReader:createReader}=require('../src/network-query.cjs');
function createMetadataReader(execute){let clock=0;return createReader(execute,()=>clock+=5000)}
const {networkSnapshot,resolveNetworkSelection,createNetworkWaiter}=require('../src/network-selection.cjs');
const address={family:'IPv4',address:'192.0.2.2',internal:false};
const adapter={name:'Public WiFi',description:'Wireless Adapter',guid:'fixture-guid',up:true,wireless:true,lanCandidate:true,defaultRoute:true};
const record=value=>JSON.stringify(value)+'\n';
function mock(responses,calls=[]){return (_file,args,options,done)=>{
 const code=args.at(-1),stage=code.includes('GetAllNetworkInterfaces')?'adapters':code.includes('TetheringManager')?'tethering':'sharing';calls.push({stage,options});
 const response=responses[stage];assert.ok(response,'unexpected query '+stage);queueMicrotask(()=>done(response.error,response.out||''));
}}
const timeout={killed:true,signal:'SIGTERM',code:null};
test('LAN does not query hotspot providers and retains basic adapters after CIM timeout',async()=>{
 const calls=[],read=createMetadataReader(mock({adapters:{error:timeout,out:record({adapters:[adapter],adapterSource:'dotnet',adapterPhase:'netadapter'})+'{"incomplete":'}},calls));
 const metadata=await read({mode:'lan'}),state=networkSnapshot({'Public WiFi':[address]},metadata);
 assert.deepEqual(calls.map(c=>c.stage),['adapters']);assert.equal(resolveNetworkSelection('lan','',state).ok,true);
 assert.equal(metadata.queries[0].code,'TIMEOUT');assert.equal(metadata.queries[0].source,'dotnet');
 assert.equal(metadata.queries[0].phase,'netadapter');
 assert.equal(JSON.stringify(state.diagnostic).includes('Public WiFi'),false);
 assert.equal(JSON.stringify(state.diagnostic).includes('192.0.2.2'),false);
});
test('independent sharing timeout cannot erase WinRT confirmation of the sole live downstream',async()=>{
 const hotspot={...adapter,name:'Shared',description:'Microsoft Wi-Fi Direct Virtual Adapter',defaultRoute:false};
 const read=createMetadataReader(mock({adapters:{out:record({adapters:[hotspot]})},tethering:{out:record({tetheringStates:['On']})},sharing:{error:timeout}}));
 const state=networkSnapshot({Shared:[address]},await read({mode:'hotspot'}));
 assert.equal(resolveNetworkSelection('hotspot','',state).ok,true);assert.equal(state.sharingError,'SHARING_TIMEOUT');
});
test('ICS GUID matching survives renamed adapters and independent WinRT timeout',async()=>{
 const hotspot={...adapter,name:'Renamed shared adapter',description:'Microsoft Wi-Fi Direct Virtual Adapter',defaultRoute:false};
 const read=createMetadataReader(mock({adapters:{out:record({adapters:[hotspot]})},tethering:{error:timeout},sharing:{out:record({sharingAvailable:true,privateNames:['Old shared name'],privateIds:['{fixture-guid}']})}}));
 const state=networkSnapshot({[hotspot.name]:[address]},await read({mode:'hotspot'}));
 assert.equal(resolveNetworkSelection('hotspot','',state).name,hotspot.name);
});
test('total adapter query failure reports query failure rather than invalid hardware',async()=>{
 for(const response of [{error:timeout},{out:'not json'},{error:{code:'ENOENT',message:'private path',stderr:'private network'}}]){
  const metadata=await createMetadataReader(mock({adapters:response}))({mode:'lan'});
  const state=networkSnapshot({'Public WiFi':[address]},metadata),result=resolveNetworkSelection('lan','Public WiFi',state);
  assert.equal(result.code,'NETWORK_QUERY_FAILED');assert.match(result.error,/查询失败或超时/);
  assert.equal(/private path|private network/.test(JSON.stringify(result.diagnostic)),false);
 }
});
test('basic fallback excludes VPN, virtual and disconnected interfaces and never infers an active hotspot',()=>{
 for(const changes of [{description:'WireGuard Tunnel'},{description:'Tailscale'},{description:'Virtual Ethernet'},{up:false},{physical:false}]){
  const state=networkSnapshot({'Public WiFi':[address]},{adapters:[{...adapter,...changes}]});
  assert.equal(resolveNetworkSelection('lan','Public WiFi',state).ok,false);
 }
 const hotspot={...adapter,description:'Microsoft Wi-Fi Direct Virtual Adapter',defaultRoute:false};
 assert.equal(resolveNetworkSelection('hotspot','',networkSnapshot({'Public WiFi':[address]},{adapters:[hotspot]})).ok,false);
});
test('native adapter evidence supersedes fallback and route failure retains completed metadata',async()=>{
 const out=record({adapters:[adapter],adapterSource:'dotnet'})+record({adapters:[{...adapter,physical:false}],adapterSource:'netadapter',adapterPhase:'routes'});
 const state=networkSnapshot({'Public WiFi':[address]},await createMetadataReader(mock({adapters:{error:timeout,out}}))({mode:'lan'}));
 assert.equal(resolveNetworkSelection('lan','Public WiFi',state).ok,false);
 assert.equal(state.diagnostic.queries[0].phase,'routes');
});
test('network waiter forwards mode and cancellation without retrying complete query failure',async()=>{
 const signal=new AbortController().signal;let reads=0;
 const waiter=createNetworkWaiter(async options=>{reads++;assert.equal(options.mode,'hotspot');assert.equal(options.signal,signal);return networkSnapshot({},{queryFailed:true})},()=>{throw Error('must not retry')});
 assert.equal((await waiter('hotspot','',{signal})).code,'NETWORK_QUERY_FAILED');assert.equal(reads,1);
});

test('output limits and cancellation are distinguished from timeout',async()=>{
 for(const [error,expected] of [[{killed:true,code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'},'OUTPUT_LIMIT'],[{code:1},'EXIT_1']]){
  const metadata=await createMetadataReader(mock({adapters:{error}}))({mode:'lan'});
  assert.equal(metadata.queries[0].code,expected);
 }
 const controller=new AbortController();controller.abort();
 const metadata=await createMetadataReader(mock({adapters:{error:{code:'ABORT_ERR'}}}))({mode:'lan',signal:controller.signal});
 assert.equal(metadata.queries[0].code,'CANCELLED');
});
