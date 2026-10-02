const test = require('node:test'), assert = require('node:assert/strict');
const {HandoffRecovery} = require('../build/engine/handoffRecovery');

function harness(options = {}) {
 let now = 0;
 const pending = new Map(), events = [];
 const clock = {
  setTimeout(callback, delay) {
   const timer = {unref() {}};
   pending.set(timer, {callback, due:now + delay});
   return timer;
  },
  clearTimeout(timer) { pending.delete(timer); }
 };
 const recovery = new HandoffRecovery({
  alternateHost:'fe80::2',
  onFallback:host => events.push({type:'fallback', host, time:now}),
  onWait:() => events.push({type:'wait', time:now}),
  ...options
 }, clock);
 function advance(milliseconds) {
  const target = now + milliseconds;
  while (true) {
   const next = [...pending.entries()].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
   if (!next) break;
   const [timer, value] = next;
   now = value.due;
   pending.delete(timer);
   value.callback();
  }
  now = target;
 }
 return {recovery, events, pending, advance};
}

test('one fallback at 12 seconds and one wait notice at 20 seconds without extending on repeated negotiation', () => {
 const h = harness();
 h.recovery.negotiationStarted();
 h.advance(8000);
 h.recovery.negotiationStarted();
 assert.equal(h.pending.size, 2);
 h.advance(3999);
 assert.deepEqual(h.events, []);
 h.advance(1);
 assert.deepEqual(h.events, [{type:'fallback', host:'fe80::2', time:12000}]);
 h.recovery.negotiationStarted();
 h.advance(8000);
 assert.deepEqual(h.events, [{type:'fallback', host:'fe80::2', time:12000}, {type:'wait', time:20000}]);
 h.recovery.negotiationStarted();
 h.advance(60000);
 assert.equal(h.events.length, 2);
 assert.equal(h.pending.size, 0);
});

test('TCP connection before negotiation permanently suppresses recovery', () => {
 const h = harness();
 h.recovery.networkConnected();
 h.recovery.negotiationStarted();
 h.advance(60000);
 assert.equal(h.pending.size, 0);
 assert.deepEqual(h.events, []);
});

test('TCP during the initial wait cancels both timers and prevents rearming', () => {
 const h = harness();
 h.recovery.negotiationStarted();
 h.advance(11000);
 h.recovery.networkConnected();
 h.recovery.negotiationStarted();
 h.advance(60000);
 assert.equal(h.pending.size, 0);
 assert.deepEqual(h.events, []);
});

test('TCP after fallback cancels the remaining wait notice', () => {
 const h = harness();
 h.recovery.negotiationStarted();
 h.advance(12000);
 h.recovery.networkConnected();
 h.recovery.negotiationStarted();
 h.advance(60000);
 assert.deepEqual(h.events, [{type:'fallback', host:'fe80::2', time:12000}]);
 assert.equal(h.pending.size, 0);
});

test('stopping before or after fallback cancels timers and is idempotent', () => {
 for (const elapsed of [0, 12000]) {
  const h = harness();
  h.recovery.negotiationStarted();
  h.advance(elapsed);
  h.recovery.cancel();
  h.recovery.cancel();
  h.recovery.negotiationStarted();
  h.advance(60000);
  assert.equal(h.events.length, elapsed ? 1 : 0);
  assert.equal(h.pending.size, 0);
 }
 const beforeStart = harness();
 beforeStart.recovery.cancel();
 beforeStart.recovery.negotiationStarted();
 beforeStart.advance(60000);
 assert.deepEqual(beforeStart.events, []);
});

test('LAN without an alternate only shows the wait notice; hotspot without either hook does nothing', () => {
 const lan = harness({alternateHost:undefined});
 lan.recovery.negotiationStarted();
 assert.equal(lan.pending.size, 1);
 lan.advance(60000);
 assert.deepEqual(lan.events, [{type:'wait', time:20000}]);
 const hotspot = harness({alternateHost:' ', onWait:undefined});
 hotspot.recovery.negotiationStarted();
 hotspot.recovery.negotiationStarted();
 hotspot.advance(60000);
 assert.deepEqual(hotspot.events, []);
 assert.equal(hotspot.pending.size, 0);
 const fallbackOnly = harness({onWait:undefined});
 fallbackOnly.recovery.negotiationStarted();
 fallbackOnly.advance(60000);
 assert.deepEqual(fallbackOnly.events, [{type:'fallback', host:'fe80::2', time:12000}]);
});

test('callbacks already queued when stop or TCP occurs remain suppressed', () => {
 for (const stop of ['cancel', 'networkConnected']) {
  const h = harness();
  h.recovery.negotiationStarted();
  const queued = [...h.pending.values()].map(value => value.callback);
  h.recovery[stop]();
  queued.forEach(callback => callback());
  assert.deepEqual(h.events, []);
  assert.equal(h.pending.size, 0);
 }
});
