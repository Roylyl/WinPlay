const test=require('node:test'),assert=require('node:assert/strict');
const {PassiveReconnect}=require('../src/passive-reconnect.cjs');
function fixture(attempt=async()=>{}){let next=0;const timers=new Map(),waits=[];const reconnect=new PassiveReconnect({attempt,onWait:(seconds)=>waits.push(seconds),setTimer:(fn)=>{timers.set(++next,fn);return next},clearTimer:id=>timers.delete(id)});return {reconnect,timers,waits,async tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn()}}}
test('reconnection backs off and keeps only one outstanding attempt',async()=>{
 const f=fixture(async()=>{throw Error('offline')});f.reconnect.retry();f.reconnect.retry();assert.equal(f.timers.size,1);
 for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.waits,[5,10,20,30,60,60,60]);assert.equal(f.timers.size,1);
});
test('manual cancellation prevents a queued retry and resets backoff',async()=>{
 let attempts=0;const f=fixture(async()=>attempts++);f.reconnect.retry();f.reconnect.cancel();assert.equal(f.timers.size,0);assert.equal(f.reconnect.active,false);assert.equal(attempts,0);f.reconnect.retry();assert.deepEqual(f.waits,[5,5]);
});
test('cancel during a running attempt prevents retry even if it subsequently fails',async()=>{
 let reject;const f=fixture(()=>new Promise((_,r)=>reject=r));f.reconnect.retry();const pending=f.tick();f.reconnect.cancel();reject(Error('offline'));await pending;assert.equal(f.timers.size,0);
});
test('disconnect during an in-flight attempt schedules once after completion',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.reconnect.retry();const pending=f.tick();f.reconnect.retry();f.reconnect.retry();assert.equal(f.timers.size,0);resolve();await pending;assert.deepEqual(f.waits,[5,10]);assert.equal(f.timers.size,1);
});
test('successful connection cancels retry and the next disconnection starts at five seconds',async()=>{
 const f=fixture(async()=>f.reconnect.cancel());f.reconnect.retry();await f.tick();assert.equal(f.timers.size,0);assert.equal(f.reconnect.active,false);f.reconnect.retry();assert.deepEqual(f.waits,[5,5]);
});
test('a new disconnection after success is not lost while the previous attempt finishes',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.reconnect.retry();const pending=f.tick();f.reconnect.cancel();f.reconnect.retry();resolve();await pending;assert.equal(f.timers.size,1);assert.deepEqual(f.waits,[5,5]);
});
test('only established passive disconnections are eligible; disabled and initial failures stay stopped',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
 const body=source.slice(source.indexOf('function passiveDisconnect()'),source.indexOf('function stopped()'));
 for(const [enabled,established,expected] of [[false,true,0],[true,false,0],[true,true,1]]){
  let retries=0,stops=0;const context={settings:{autoReconnect:enabled},closing:false,reconnectConfig:{targetBluetooth:'test'},sessionEstablished:established,engine:undefined,passiveReconnect:{active:false,retry(){retries++}},stopped(){stops++}};
  vm.createContext(context);vm.runInContext(body+'\npassiveDisconnect()',context);assert.equal(retries,expected);assert.equal(stops,1);assert.equal(context.sessionEstablished,false);
 }
});
