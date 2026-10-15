const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {resolveNetworkSelection}=require('../src/network-selection.cjs');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
const block=source.slice(source.indexOf("case 'read-current-network':")+"case 'read-current-network':".length,source.indexOf("case 'check-updates':"));
const run=new (Object.getPrototypeOf(async()=>{}).constructor)('arg','settings','require','readCurrentNetwork',block);
function fixture(items,recommended,name=''){
 const reads=[],queries=[],snapshot={items,recommended:{lan:recommended},queryFailed:false};
 return {reads,queries,run:()=>run({mode:'lan'},{lanNetworkInterface:name},()=>({resolveNetworkSelection,listNetworks:async options=>{queries.push(options);return snapshot}}),async(mode,options)=>{reads.push({mode,options});return {ok:true}})};
}
test('automatic credentials use the same recommended Wi-Fi as the receiver',async()=>{
 const r=fixture([{name:'Wi-Fi A',wireless:true,lan:true,ready:true},{name:'Wi-Fi B',wireless:true,lan:true,ready:true}],'Wi-Fi B');
 assert.equal((await r.run()).ok,true);assert.equal(r.reads[0].options.interfaceName,'Wi-Fi B');assert.deepEqual(r.queries,[{mode:'lan'}]);
});
test('Ethernet credentials do not come from an unrelated Wi-Fi adapter',async()=>{
 for(const selected of ['','Ethernet']){
  const r=fixture([{name:'Ethernet',wireless:false,lan:true,ready:true},{name:'Other Wi-Fi',wireless:true,lan:true,ready:true}],'Ethernet',selected);
  const result=await r.run();assert.equal(result.code,'LAN_ETHERNET_CREDENTIALS');assert.match(result.error,/请填写/);assert.equal(r.reads.length,0);
 }
});
test('manual adapter choice is respected and an unavailable choice does not read another network',async()=>{
 const items=[{name:'Wi-Fi A',wireless:true,lan:true,ready:true},{name:'Wi-Fi B',wireless:true,lan:true,ready:true}];
 const manual=fixture(items,'Wi-Fi B','Wi-Fi A');await manual.run();assert.equal(manual.reads[0].options.interfaceName,'Wi-Fi A');
 const missing=fixture(items,'Wi-Fi B','Removed Wi-Fi');assert.equal((await missing.run()).ok,false);assert.equal(missing.reads.length,0);
});
