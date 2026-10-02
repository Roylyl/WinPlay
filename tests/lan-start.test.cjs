const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolveConnectionSettings,refreshLanParameters}=require('../src/connection-settings.cjs');
function receiver(readWlan,waitForNetwork=async()=>({ok:true,name:'Wi-Fi',item:{wireless:true}}),readHotspot=async()=>({ok:false})){
 const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
 const config={wirelessMode:'lan',lanSsid:'Public Test',lanPassword:'public-fixture',lanChannel:6,lanNetworkInterface:'Wi-Fi',lanAccessPointMac:'02:00:00:00:00:01',targetBluetooth:'02:00:00:00:00:02'};
 const messages=[],logs=[],events=[];
 const context={running:false,settings:config,connectionEpoch:0,AbortController,resolveConnectionSettings,refreshLanParameters,readCurrentNetwork:(mode,options)=>mode==='hotspot'?readHotspot(options):readWlan('read-network',undefined,options),
  selectedDisplay:()=>({}),displayPixels:()=>({}),videoSize:()=>({width:1280,height:720}),validateSettings:()=>{},
  send:type=>events.push(type),updateTray:()=>{},createVideo:()=>events.push('create-video'),log:(status,detail)=>logs.push({status,detail}),
  stopped:()=>{context.running=false;events.push('stopped')},
  require:()=>({waitForNetwork}),
  worker:()=>({on:()=>{},send:message=>messages.push(message)})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function start('),source.indexOf('\nfunction validateSettings(')),context);
 return {context,config,messages,logs,events};
}

test('LAN starts using current router parameters without rewriting saved credentials',async()=>{
 let readOptions;
 const r=receiver(async(op,ssid,options)=>{readOptions=options;return {ok:true,interfaceName:'Wi-Fi',ssid:'Public Test',channel:44,bssid:'02:00:00:00:00:04'}});
 await r.context.start();
 assert.equal(readOptions.interfaceName,'Wi-Fi');assert.equal(r.messages.length,1);
 const settings=r.messages[0].settings;
 assert.equal(settings.channel,44);assert.equal(settings.accessPointMac,'02:00:00:00:00:04');assert.equal(settings.password,'public-fixture');
 assert.equal(r.config.lanChannel,6);assert.equal(r.config.lanAccessPointMac,'02:00:00:00:00:01');
 assert.equal(r.events.includes('create-video'),false);
});

test('a different current Wi-Fi reports configuration mismatch before starting the receiver',async()=>{
 const r=receiver(async()=>({ok:true,interfaceName:'Wi-Fi',ssid:'Other Public Test',channel:44}));
 await assert.rejects(r.context.start(),/当前Wi-Fi与配置不一致/);
 assert.equal(r.messages.length,0);assert.equal(r.context.running,false);
 assert.equal(r.logs.at(-1).status,'启动接收失败');assert(!r.logs.at(-1).detail.includes('Other Public Test'));
});

test('stopping while current Wi-Fi is being read cannot launch a late receiver',async()=>{
 let finish;
 const r=receiver(()=>new Promise(resolve=>finish=resolve)),pending=r.context.start();
 await new Promise(resolve=>setImmediate(resolve));
 r.context.connectionEpoch++;r.context.running=false;
 finish({ok:true,interfaceName:'Wi-Fi',ssid:'Public Test',channel:44});await pending;
 assert.equal(r.messages.length,0);
});

test('hotspot starts with live Windows credentials and auto channel, without reading an upstream saved Wi-Fi password',async()=>{
 let readOptions;
 const r=receiver(()=>{throw Error('hotspot must not read upstream Wi-Fi parameters')},async()=>({ok:true,name:'Current Hotspot',diagnostic:'state=On;active=1;selection=auto',item:{wireless:true}}),async options=>{readOptions=options;return {ok:true,ssid:'Current Public Hotspot',password:'current-public-fixture',passwordRead:true,channel:0}});
 Object.assign(r.config,{wirelessMode:'hotspot',ssid:'Public Hotspot',password:'public-fixture',channel:6,networkInterface:'Expired Adapter'});
 await r.context.start();
 assert.equal(r.messages.length,1);assert.equal(r.messages[0].settings.networkInterface,'Current Hotspot');
 assert.equal(r.messages[0].settings.ssid,'Current Public Hotspot');assert.equal(r.messages[0].settings.password,'current-public-fixture');assert.equal(r.messages[0].settings.channel,0);
 assert.equal(r.config.networkInterface,'Expired Adapter');
 assert.equal(r.config.ssid,'Public Hotspot');assert.equal(readOptions.snapshot.name,'Current Hotspot');
 assert.equal(r.events.includes('create-video'),false);
 assert.equal(r.logs.filter(entry=>entry.status==='网络发现：热点接口检查').length,1);
});

test('unchanged hotspot readiness emits one wait message and records the final reason before failure',async()=>{
 const waiting={ok:false,code:'HOTSPOT_NOT_READY',error:'Windows移动热点尚未就绪',diagnostic:{state:'Off',activeCount:0}};
 const r=receiver(()=>{},async(mode,name,options)=>{options.onWait(waiting);options.onWait({...waiting,diagnostic:{...waiting.diagnostic}});return {...waiting,diagnostic:{...waiting.diagnostic}}});
 Object.assign(r.config,{wirelessMode:'hotspot',ssid:'Public Hotspot',password:'public-fixture',channel:6});
 await assert.rejects(r.context.start(),/移动热点尚未就绪/);
 assert.equal(r.messages.length,0);assert.equal(r.context.running,false);
 assert.equal(r.logs.filter(entry=>entry.status==='正在等待网络接口就绪').length,1);
 assert.equal(r.logs.filter(entry=>entry.status==='网络发现：热点接口检查').length,1);
 assert.equal(r.logs.find(entry=>entry.status==='网络发现：热点接口检查').detail,JSON.stringify(waiting.diagnostic));
 assert.equal(r.logs.at(-1).status,'启动接收失败');
});

test('manual hotspot credentials remain available when Windows configuration cannot be read',async()=>{
 const r=receiver(()=>{},async()=>({ok:true,name:'Hotspot'}));
 Object.assign(r.config,{wirelessMode:'hotspot',ssid:'Public Hotspot',password:'manual-public-fixture',channel:44});
 await r.context.start();assert.equal(r.messages[0].settings.password,'manual-public-fixture');assert.equal(r.messages[0].settings.channel,44);
});

test('stopping during hotspot credential reading cannot start a late receiver',async()=>{
 let finish;
 const r=receiver(()=>{},async()=>({ok:true,name:'Hotspot'}),()=>new Promise(resolve=>finish=resolve));
 Object.assign(r.config,{wirelessMode:'hotspot',ssid:'Public Hotspot',password:'manual-public-fixture',channel:44});
 const pending=r.context.start();await new Promise(resolve=>setImmediate(resolve));r.context.connectionEpoch++;r.context.running=false;
 finish({ok:true,ssid:'Current Public Hotspot',password:'current-public-fixture',passwordRead:true,channel:0});await pending;assert.equal(r.messages.length,0);
});

test('a hotspot state change while reading credentials prevents a stale handoff',async()=>{
 for(const hotspotState of ['Off','InTransition']){
  const r=receiver(()=>{},async()=>({ok:true,name:'Hotspot'}),async()=>({ok:true,hotspotState,ssid:'Public Hotspot',password:'public-fixture',passwordRead:true,channel:0}));
  Object.assign(r.config,{wirelessMode:'hotspot',ssid:'Public Hotspot',password:'public-fixture',channel:0});
  await assert.rejects(r.context.start(),/Windows移动热点/);assert.equal(r.messages.length,0);assert.equal(r.context.running,false);
 }
});
