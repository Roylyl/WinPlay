const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {retireReceiver}=require('../src/receiver-process.cjs');
function child(){const p=new EventEmitter();Object.assign(p,{exitCode:null,signalCode:null,connected:true,messages:[],kills:0,send(message,done){this.messages.push(message);done?.()},kill(){this.kills++;this.signalCode='SIGTERM';this.emit('exit',null,'SIGTERM')}});return p}
test('retirement requests graceful stop and waits for actual process exit',async()=>{
 const p=child();let finished=false;const waiting=retireReceiver(p).then(()=>{finished=true});
 assert.deepEqual(p.messages,[{command:'stop'}]);await Promise.resolve();assert.equal(finished,false);
 p.exitCode=0;p.emit('exit',0);await waiting;assert.equal(p.kills,0);assert.equal(p.listenerCount('exit'),0);
});
test('an unresponsive receiver is terminated before a replacement may start',async()=>{
 const p=child();await retireReceiver(p,{graceMs:5,killWaitMs:10});assert.equal(p.kills,1);assert.equal(p.listenerCount('exit'),0);
});
test('failed termination is bounded and cannot be reported as a released receiver',async()=>{
 const p=child();p.kill=()=>{p.kills++;return false};await assert.rejects(retireReceiver(p,{graceMs:5,killWaitMs:5}),/旧接收进程尚未退出/);assert.equal(p.listenerCount('exit'),0);
});
test('a closed IPC channel still waits for process exit and already exited children need no stop',async()=>{
 const p=child();p.connected=false;await retireReceiver(p,{graceMs:5,killWaitMs:10});assert.equal(p.messages.length,0);
 const exited=child();exited.exitCode=0;await retireReceiver(exited);assert.equal(exited.messages.length,0);assert.equal(exited.kills,0);
});
