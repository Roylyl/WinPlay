const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const appSource=fs.readFileSync(require.resolve('../src/ui/app.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(mode='lan'){
 const nodes=new Map(),results=[],saves=[],reads=[];
 const config={wirelessMode:mode,lanSsid:'Old public LAN',lanChannel:6,lanNetworkInterface:'Old Wi-Fi',lanAccessPointMac:'02:00:00:00:00:08',lanPassword:'public-lan-password',ssid:'Public hotspot',password:'public-hotspot-password',channel:36,networkInterface:'Hotspot adapter'};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',dataset:{}});return nodes.get(id)};
 node('wirelessMode').value=mode;
 const context={config,$:node,pendingSaves:new Set(),networkReadBusy:false,networkReadRequest:0,
  text:(id,text)=>node(id).textContent=text,result:(...values)=>results.push(values),networks:async()=>{},t:source=>source,
  winplay:{call:async(op,args)=>{reads.push({op,args});return {ok:true,mode,ssid:'Public network fixture',password:'public-read-password',channel:44,bssid:'02:00:00:00:00:02',interfaceName:mode==='lan'?'Wi-Fi 2':'Hotspot 2',passwordRead:true}}},
  call:async(op,values)=>{saves.push({op,values});return {ok:true}}
 };
 const fieldsStart=appSource.indexOf('function fieldKey('),fieldsEnd=appSource.indexOf('function state(',fieldsStart);vm.runInNewContext(appSource.slice(fieldsStart,fieldsEnd),context);
 const start=appSource.indexOf("$('read-network').onclick=async()=>{"),end=appSource.indexOf('\n  };',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(appSource.slice(start,end+6),context);
 return {context,nodes,node,config,results,saves,reads,read:()=>node('read-network').onclick()};
}
test('one reading control replaces the saved-password control in both modes',()=>{
 const html=fs.readFileSync(require.resolve('../src/ui/index.html'),'utf8');
 assert.ok(html.includes('id="read-network" data-i18n="读取当前网络和密码"'));
 assert.ok(!html.includes('id="read-password"')&&!html.includes('id="password-result"'));
 assert.ok(!appSource.includes("$('read-password')")&&!appSource.includes('passwordBusy'));
});
test('LAN reading saves coherent network and password values without changing hotspot configuration',async()=>{
 const r=fixture(),save=deferred();r.context.call=(op,values)=>{r.saves.push({op,values});return save.promise};
 const operation=r.read();await tick();
 assert.equal(r.context.pendingSaves.size,1);assert.equal(r.config.lanSsid,'Old public LAN');assert.equal(r.node('read-network').disabled,true);assert.equal(r.node('read-network').textContent,'正在读取网络和密码…');
 assert.equal(r.reads[0].op,'read-current-network');assert.equal(r.reads[0].args.mode,'lan');assert.equal(Object.keys(r.saves[0].values).length,5);
 save.resolve({ok:true});await operation;
 assert.equal(r.config.lanNetworkInterface,'Wi-Fi 2');assert.equal(r.config.lanSsid,'Public network fixture');assert.equal(r.config.lanChannel,44);assert.equal(r.config.lanAccessPointMac,'02:00:00:00:00:02');assert.equal(r.config.lanPassword,'public-read-password');
 assert.equal(r.config.password,'public-hotspot-password');assert.equal(r.config.ssid,'Public hotspot');assert.equal(r.config.networkInterface,'Hotspot adapter');assert.equal(r.context.pendingSaves.size,0);
 assert.equal(r.node('password').value,'public-read-password');assert.equal(r.node('read-network').disabled,false);assert.equal(r.node('read-network').textContent,'读取当前网络和密码');
});
test('hotspot reading works with an empty SSID and preserves its real channel when the API does not expose one',async()=>{
 const r=fixture('hotspot');r.config.ssid='';r.node('ssid').value='';r.context.winplay.call=async(op,args)=>{r.reads.push({op,args});return {ok:true,mode:'hotspot',ssid:'Public local AP',password:'public-ap-password',interfaceName:'Hotspot 2',passwordRead:true}};
 await r.read();assert.equal(r.reads.length,1);assert.equal(r.reads[0].args.mode,'hotspot');assert.equal(r.config.ssid,'Public local AP');assert.equal(r.config.password,'public-ap-password');assert.equal(r.config.channel,36);assert.equal(r.config.networkInterface,'Hotspot 2');
 assert.equal(r.config.lanSsid,'Old public LAN');assert.equal(r.config.lanPassword,'public-lan-password');assert.equal(Object.keys(r.saves[0].values).length,3);assert.equal(r.node('read-network').disabled,false);
});
test('hotspot channel zero is saved as automatic while LAN channel controls retain a minimum of one',async()=>{
 const r=fixture('hotspot');r.context.winplay.call=async()=>({ok:true,mode:'hotspot',ssid:'Public local AP',password:'public-ap-password',channel:0,channelKnown:false,warning:'公开测试：信道自动发现'});
 await r.read();assert.equal(r.config.channel,0);assert.equal(r.saves[0].values.channel,0);assert.equal(r.node('channel').value,0);assert.equal(r.node('channel').min,'0');assert.ok(r.node('network-help').textContent.includes('信道0表示自动'));assert.equal(r.config.lanChannel,6);
 r.config.wirelessMode='lan';r.context.wirelessFields();assert.equal(r.node('channel').min,'1');assert.equal(r.node('channel').value,6);assert.equal(r.node('read-network').disabled,false);
});
test('partial reading preserves the existing password and reports the specific missing-password reason',async()=>{
 const r=fixture();r.context.winplay.call=async()=>({ok:true,mode:'lan',ssid:'Public network fixture',interfaceName:'Wi-Fi 2',passwordRead:false,warning:'公开测试：没有已保存的共享密码'});
 await r.read();assert.equal(r.config.lanSsid,'Public network fixture');assert.equal(r.config.lanPassword,'public-lan-password');assert.equal(r.config.password,'public-hotspot-password');assert.ok(!Object.hasOwn(r.saves[0].values,'lanPassword'));
 assert.deepEqual(r.results.at(-1),['network-result','已读取当前网络，未能读取密码；已保留原密码。','公开测试：没有已保存的共享密码']);
});
test('mode changes during reading discard stale results, including a round trip back to the same mode',async()=>{
 for(const nextMode of ['hotspot','lan']){
  const r=fixture(),read=deferred();r.context.winplay.call=()=>read.promise;const operation=r.read();await tick();
  ++r.context.networkReadRequest;r.config.wirelessMode=nextMode;r.node('wirelessMode').value=nextMode;read.resolve({ok:true,mode:'lan',ssid:'Other public fixture',password:'public-other-password'});await operation;
  assert.equal(r.saves.length,0);assert.equal(r.config.ssid,'Public hotspot');assert.equal(r.config.lanSsid,'Old public LAN');assert.equal(r.context.pendingSaves.size,0);assert.equal(r.node('read-network').disabled,false);
 }
});
test('mode changes during saving update only the captured mode and never replace the active form',async()=>{
 const r=fixture(),save=deferred();r.context.call=(op,values)=>{r.saves.push({op,values});return save.promise};const operation=r.read();await tick();
 ++r.context.networkReadRequest;r.config.wirelessMode='hotspot';r.node('wirelessMode').value='hotspot';r.context.wirelessFields();save.resolve({ok:true});await operation;
 assert.equal(r.config.lanSsid,'Public network fixture');assert.equal(r.config.ssid,'Public hotspot');assert.equal(r.config.password,'public-hotspot-password');assert.equal(r.node('ssid').value,'Public hotspot');assert.equal(r.node('password').value,'public-hotspot-password');assert.equal(r.results.length,1);
});
test('reading waits for pending mode saves and remains pending until all read values are saved',async()=>{
 const r=fixture(),mode=deferred();r.config.wirelessMode='hotspot';r.context.pendingSaves.add(mode.promise);const operation=r.read();await tick();assert.equal(r.reads.length,0);assert.equal(r.context.pendingSaves.size,2);
 r.config.wirelessMode='lan';mode.resolve({ok:true});await operation;assert.equal(r.reads.length,1);assert.equal(r.config.lanSsid,'Public network fixture');assert.equal(r.context.pendingSaves.size,1);
});
test('save errors keep configuration untouched, remain visible and release the reading control',async()=>{
 const r=fixture();r.context.call=async()=>({ok:false,error:'公开测试保存失败'});const saved=await r.read();assert.equal(saved.ok,false);assert.equal(r.config.lanSsid,'Old public LAN');assert.equal(r.config.lanPassword,'public-lan-password');assert.deepEqual(r.results.at(-1),['network-result','公开测试保存失败']);assert.equal(r.node('read-network').disabled,false);assert.equal(r.context.pendingSaves.size,0);
});
test('a busy reading control does not send duplicate IPC requests',async()=>{
 const r=fixture(),read=deferred();r.context.winplay.call=(op,args)=>{r.reads.push({op,args});return read.promise};const operation=r.read();await tick();await r.read();assert.equal(r.reads.length,1);read.resolve({ok:false,error:'公开测试读取失败'});await operation;assert.equal(r.node('read-network').disabled,false);
});
test('an IPC exception becomes a failed pending result instead of an unhandled start rejection',async()=>{
 const r=fixture(),read=deferred();r.context.winplay.call=()=>read.promise;const operation=r.read();await tick();const pending=Promise.all([...r.context.pendingSaves]);read.reject(Error('公开测试接口异常'));const results=await pending;await operation;assert.equal(results[0].ok,false);assert.equal(r.config.lanSsid,'Old public LAN');assert.equal(r.context.pendingSaves.size,0);assert.equal(r.node('read-network').disabled,false);assert.deepEqual(r.results.at(-1),['network-result','公开测试接口异常']);
});
test('combined network warnings translate individually without changing public network names',()=>{
 const i18n=require('../src/ui/i18n.js'),context={WinPlayI18n:i18n,config:{language:'en'},locale:'zh-CN',t:source=>i18n.translate(source,'en')};
 vm.runInNewContext(appSource.match(/^function resultDetail\(source\)\{[^\n]+\}/m)[0],context);
 const source='Windows未提供移动热点的实际信道，已使用0自动发现；热点尚未开启，已读取Windows保存的热点配置',value=context.resultDetail(source);
 assert.ok(value.includes('Channel 0 uses automatic discovery; '));assert.ok(value.includes('The hotspot is off.'));assert.ok(!/[\u3400-\u9fff]/u.test(value));assert.equal(i18n.translate('公开网络测试/2026','en'),'公开网络测试/2026');
 assert.notEqual(i18n.translate('热点信道必须为0—196，0表示自动','en'),'热点信道必须为0—196，0表示自动');
});
