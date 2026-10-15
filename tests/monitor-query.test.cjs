const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function harness(){
 const calls=[],context={native:'test-platform.exe',Date,execFile:(...args)=>calls.push(args)};
 vm.createContext(context);
 vm.runInContext('let nativeMonitorRead,nativeMonitorEpoch=0,nativeMonitors=[];'+source.slice(source.indexOf('function nativeMonitorFailure'),source.indexOf('function displayPixels')),context);
 return {context,calls,read:()=>context.refreshNativeMonitors(),snapshot:()=>JSON.parse(vm.runInContext('JSON.stringify(nativeMonitors)',context))};
}
function detail(error){return JSON.parse(error.message.slice(error.message.indexOf('：')+1))}
test('monitor helper failures preserve safe timeout, exit and Win32 codes without process arguments or paths',()=>{
 const {context}=harness(),secret='C:\\Users\\PrivateUser\\AppData\\WinPlay.exe';
 const timeout=detail(context.nativeMonitorFailure({code:null,killed:true,signal:'SIGTERM',message:secret},secret,5012));
 assert.deepEqual(timeout,{stage:'monitors',reason:'process-failed',elapsedMs:5012,signal:'SIGTERM',killed:true,timedOut:true});
 const missing=detail(context.nativeMonitorFailure({code:'ENOENT',path:secret,message:secret},secret,4));
 assert.equal(missing.errorCode,'ENOENT');assert.equal(missing.timedOut,false);
 const exited=detail(context.nativeMonitorFailure({code:1,killed:false},'无法读取显示器物理像素，Windows错误码=5\n'+secret,15));
 assert.equal(exited.exitCode,1);assert.equal(exited.win32Error,5);
 const buffer=detail(context.nativeMonitorFailure({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,signal:'SIGTERM'},secret,5100));
 assert.equal(buffer.timedOut,false);
 for(const value of [timeout,missing,exited,buffer])assert.equal(JSON.stringify(value).includes(secret),false);
});
test('monitor refresh coalesces concurrent requests and discards stale dimensions on process failure',async()=>{
 const h=harness(),first=h.read(),same=h.read();assert.equal(first,same);assert.equal(h.calls.length,1);
 const rect={x:0,y:0,width:1920,height:1080};h.calls[0][3](null,JSON.stringify({items:[rect]}),'');await first;
 assert.deepEqual(h.snapshot(),[rect]);
 const retry=h.read();h.calls[1][3]({code:'EACCES'},'','private process details');
 await assert.rejects(retry,error=>detail(error).errorCode==='EACCES');assert.deepEqual(h.snapshot(),[]);
 const again=h.read();assert.equal(h.calls.length,3);h.calls[2][3](null,JSON.stringify({items:[rect]}),'');await again;
 assert.deepEqual(h.snapshot(),[rect]);
});
test('malformed and invalid monitor responses are classified without echoing response content',async()=>{
 for(const [output,reason] of [['private malformed response','invalid-json'],['null','invalid-metrics'],[JSON.stringify({items:[null]}),'invalid-metrics'],[JSON.stringify({items:[{x:0,y:0,width:0,height:1080}]}),'invalid-metrics']]){
  const h=harness(),pending=h.read();h.calls[0][3](null,output,'');
  await assert.rejects(pending,error=>{assert.equal(detail(error).reason,reason);assert.equal(error.message.includes(output),false);return true});
  assert.deepEqual(h.snapshot(),[]);
 }
});

test('a monitor change invalidates an enumeration already in flight',async()=>{
 const h=harness(),pending=h.read();vm.runInContext('nativeMonitorEpoch++',h.context);
 h.calls[0][3](null,JSON.stringify({items:[{x:0,y:0,width:1920,height:1080}]}),'');
 await assert.rejects(pending,error=>detail(error).reason==='display-changed');assert.deepEqual(h.snapshot(),[]);
});
