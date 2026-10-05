const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {redactText}=require('../src/diagnostic-redactor.cjs');
function logger(){
 const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
 const events=[],writes=[];let scheduled=0;
 const context={diagnostics:[],redactText,Date,path:require('node:path'),dataDir:'test-data',fs:{mkdirSync(){},writeFileSync(_path,value){writes.push(JSON.parse(value))}},send:(type,payload)=>events.push({type,...payload}),setTimeout:()=>++scheduled,clearTimeout(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let diagnosticWriteTimer'),source.indexOf('function restoreMain')),context);
 return {context,events,writes,scheduled:()=>scheduled};
}
test('diagnostic events are retained and redacted before reaching both UI and disk',()=>{
 const {context,events,writes,scheduled}=logger();
 vm.runInContext("diagnosticAttempt='attempt-1';diagnosticStarted=Date.now()-20",context);
 context.log('后续握手','peer=192.168.1.2 Windows error=10060',true);
 context.log('连接诊断：网络参数选定','IPv4');
 assert.equal(events[0].type,'diagnostic');assert.equal(events[1].type,'diagnostic');
 assert.ok(!events[0].detail.includes('192.168'));assert.match(events[0].detail,/10060/);
 assert.equal(scheduled(),1);context.flushDiagnostics();
 assert.equal(writes[0][0].attempt,'attempt-1');assert.ok(writes[0][0].elapsedMs>=20);
 assert.equal(writes[0][0].detail,events[0].detail);
});
test('retention keeps the newest 1000 records without writing every entry',()=>{
 const {context,writes,scheduled}=logger();
 for(let i=0;i<1005;i++)context.log('连接诊断：统计',String(i));
 assert.equal(scheduled(),1);context.flushDiagnostics();
 assert.equal(writes[0].length,1000);assert.equal(writes[0][0].detail,'5');assert.equal(writes[0][999].detail,'1004');
});
