const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function receiverEvents(){
 const source=fs.readFileSync(require.resolve('../src/ui/app.js'),'utf8');
 const start=source.indexOf('winplay.on(message=>{'),end=source.indexOf('\n(async()=>{',start);
 const values={},nodes={};let receive;
 const context={lastReceiverStatus:'',config:undefined,window:{},navigator:{},logs:[],
  winplay:{on:fn=>receive=fn},$:id=>nodes[id]??=( {} ),text:(id,value)=>values[id]=value,
  state:()=>{},metadata:()=>{},diagnosticLine:message=>message.status,renderLogs:()=>{}};
 vm.runInNewContext(source.slice(start,end),context);
 return {receive,values};
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
