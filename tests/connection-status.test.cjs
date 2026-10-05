const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function receiverEvents(){
 const source=fs.readFileSync(require.resolve('../src/ui/app.js'),'utf8');
 const start=source.indexOf('winplay.on(message=>{'),end=source.indexOf('\n(async()=>{',start);
 const values={},nodes={};let receive;
 const context={lastReceiverStatus:'',running:false,config:undefined,window:{},navigator:{},logs:[],
  winplay:{on:fn=>receive=fn},$:id=>nodes[id]??={classList:{toggle:(name,enabled)=>{nodes[id][name]=enabled}}},text:(id,value)=>values[id]=value,
  metadata:()=>{},diagnosticLine:message=>message.status,renderLogs:()=>{}};
 vm.runInNewContext(source.match(/^function state\(active\).*$/m)[0]+'\n'+source.slice(start,end),context);
 return {receive,values,nodes};
}

test('network failure remains visible after background discovery diagnostics and disconnect',()=>{
 const {receive,values}=receiverEvents();
 receive({type:'status',status:'iPhone网络连接超时',detail:'手机尚未连接接收端'});
 receive({type:'diagnostic',status:'网络发现：等待服务地址解析'});
 assert.equal(values.status,'iPhone网络连接超时');
 receive({type:'stopped'});
 assert.equal(values.status,'iPhone网络连接超时');assert.equal(values['status-detail'],'手机尚未连接接收端');
});

test('starting a new attempt clears the previous failure before a normal stop',()=>{
 const {receive,values}=receiverEvents();
 receive({type:'status',status:'iPhone网络连接超时'});receive({type:'stopped'});
 receive({type:'starting'});receive({type:'diagnostic',status:'网络发现：IPv4就绪'});receive({type:'stopped'});
 assert.equal(values.status,'接收已停止');
});

test('video arrival updates both connection indicators and later handshake diagnostics do not overwrite it',()=>{
 const {receive,values}=receiverEvents();
 receive({type:'status',status:'已发送CarPlay参数，等待iPhone网络连接'});
 receive({type:'connected'});
 receive({type:'diagnostic',status:'已发送CarPlay参数，等待iPhone网络连接'});
 assert.equal(values.status,'正在接收CarPlay视频');
 assert.equal(values['side-status'],'已收到视频');
 assert.equal(values['status-detail'],'');
 receive({type:'status',status:'视频通道正在重新连接'});
 assert.equal(values.status,'视频通道正在重新连接');
 receive({type:'stopped'});
 assert.equal(values.status,'接收已停止');
});

test('Wi-Fi disconnection closes the old video and preserves the reason, with optional reconnection',()=>{
 const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
 const lifecycle=source.match(/^function closeVideo\(\).*$/m)[0]+'\n'+source.slice(source.indexOf('function passiveDisconnect()'),source.indexOf('function stop()'))+'\n'+source.slice(source.indexOf('function handleEngineMessage('),source.indexOf('async function start('));
 for(const autoReconnect of [false,true]){
  const ui=receiverEvents(),events=[];
  ui.receive({type:'starting'});ui.receive({type:'connected'});
  const context={settings:{autoReconnect},closing:false,sessionEstablished:true,reconnectConfig:{},engine:{},running:true,videoReady:true,videoDecoded:true,pendingFrames:[Buffer.from('old frame')],lastConfig:{},pendingVideoSettings:{},stats:{requested:60,attempt:60,receivedFps:60,decodedFps:60,decodedWidth:1280,decodedHeight:720},
   video:{isDestroyed:()=>false,destroy:()=>events.push('video-destroyed')},updateTray:()=>{},retire:()=>events.push('receiver-retired'),
   log:(status,detail)=>ui.receive({type:'status',status,detail}),send:(type,fields)=>{events.push(type);ui.receive({type,...fields})},
   passiveReconnect:{active:false,retry:()=>{events.push('retry');ui.receive({type:'reconnect-wait'})}}};
  vm.createContext(context);vm.runInContext(lifecycle,context);
  vm.runInContext("handleEngineMessage({type:'status',status:'iPhone网络连接已断开',detail:'未收到iPhone的网络心跳，请检查Wi-Fi连接。'});handleEngineMessage({type:'stopped'});",context);
  assert.equal(ui.values.status,'iPhone网络连接已断开');assert.equal(ui.values['status-detail'],'未收到iPhone的网络心跳，请检查Wi-Fi连接。');
  assert.equal(context.running,false);assert.equal(context.video,undefined);assert.equal(context.pendingFrames.length,0);assert.equal(context.lastConfig,undefined);assert.equal(context.videoDecoded,false);
  assert.equal(context.stats.receivedFps,0);assert.equal(context.stats.decodedWidth,0);assert.equal(ui.nodes['show-video'].disabled,true);
  assert.ok(events.indexOf('video-destroyed')<events.indexOf('stopped'));
  assert.equal(events.includes('retry'),autoReconnect);
  assert.equal(ui.values['side-status'],autoReconnect?'等待自动重连':'未连接');
  assert.equal(ui.nodes['running-actions'].hidden,!autoReconnect);assert.equal(ui.values.start,autoReconnect?'应用并重新连接':'启动接收');
 }
});

test('network disconnection status and explanation translate to Traditional Chinese and English',()=>{
 const {translate}=require('../src/ui/i18n.js');
 for(const text of ['iPhone网络连接已断开','未收到iPhone的网络心跳，请检查Wi-Fi连接。'])for(const language of ['zh-Hant','en'])assert.notEqual(translate(text,language),text);
});
