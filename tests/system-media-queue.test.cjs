const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {SystemMedia} = require('../src/system-media.cjs');

function fixture(t, restartDelays = []) {
 const children = [], errors = [], commands = [];
 const media = new SystemMedia('fixture.exe', message => commands.push(message), error => errors.push(error), {
  restartDelays,
  spawnImpl() {
   const child = new EventEmitter();
   child.stdout = new PassThrough();
   child.stderr = new PassThrough();
   child.stdin = new EventEmitter();
   child.stdin.writable = true;
   child.stdin.destroyed = false;
   child.messages = [];
   child.accept = true;
   child.exitCode = null;
   child.stdin.write = line => { child.messages.push(JSON.parse(line)); return child.accept; };
   child.stdin.end = line => { child.messages.push(JSON.parse(line)); child.stdin.writable = false; child.exitCode = 0; child.emit('exit', 0); };
   child.kill = () => { child.exitCode = 1; child.emit('exit', 1); };
   children.push(child);
   return child;
  }
 });
 t.after(() => media.close());
 const ready = child => child.stdout.write('{"type":"ready"}\n');
 return {media, children, errors, commands, ready};
}

test('delayed media bridge retains the latest lyrics, cover and progress together', t => {
 const {media, children:[child], ready} = fixture(t);
 media.update({title:'song', artwork:Buffer.from('cover'), positionMs:0}, true);
 for (let i = 1; i <= 100; i++) {
  media.update({title:`lyric ${i}`, positionMs:i}, false);
  media.position(i * 100);
 }
 ready(child);
 assert.equal(child.messages.length, 1);
 assert.equal(child.messages[0].title, 'lyric 100');
 assert.equal(child.messages[0].positionMs, 10000);
 assert.equal(child.messages[0].artwork, Buffer.from('cover').toString('base64'));
 assert.equal(child.messages[0].artChanged, true);
 media.update({title:'next lyric', positionMs:10001}, false);
 assert.equal(child.messages[1].artChanged, false, 'ordinary lyrics do not resend the cover');
});

test('pipe backpressure coalesces pending updates and clear cancels stale track state', t => {
 const {media, children:[child], ready} = fixture(t);
 ready(child);
 child.accept = false;
 media.update({title:'song', artwork:Buffer.from('cover')}, true);
 for (let i = 0; i < 1000; i++) media.position(i);
 assert.equal(child.messages.length, 1);
 child.accept = true;
 child.stdin.emit('drain');
 assert.equal(child.messages.length, 2);
 assert.equal(child.messages[1].positionMs, 999);
 child.accept = false;
 media.position(1000);
 media.update({title:'stale pending song'}, false);
 media.clear();
 child.accept = true;
 child.stdin.emit('drain');
 assert.equal(child.messages.at(-1).command, 'clear');
 assert.ok(!child.messages.some(m => m.title === 'stale pending song'));
});

test('unexpected exit recovers the latest complete track once ready; close never respawns', async t => {
 const {media, children, errors, ready} = fixture(t, [0]);
 ready(children[0]);
 media.update({title:'song', artwork:Buffer.from('cover'), positionMs:20}, true);
 children[0].kill();
 media.position(50);
 await new Promise(resolve => setTimeout(resolve, 5));
 assert.equal(children.length, 2);
 ready(children[1]);
 assert.equal(children[1].messages[0].title, 'song');
 assert.equal(children[1].messages[0].positionMs, 50);
 assert.equal(children[1].messages[0].artChanged, true);
 assert.equal(errors.length, 1);
 media.close();
 media.close();
 media.clear();
 media.update({title:'ignored'}, false);
 await new Promise(resolve => setTimeout(resolve, 5));
 assert.equal(children.length, 2);
 assert.equal(children[1].messages.at(-1).command, 'stop');
});

test('clear during restart never resurrects the disconnected phone metadata', async t => {
 const {media, children, ready} = fixture(t, [0]);
 ready(children[0]);
 media.update({title:'old phone'}, false);
 children[0].kill();
 media.clear();
 await new Promise(resolve => setTimeout(resolve, 5));
 ready(children[1]);
 assert.deepEqual(children[1].messages, [{command:'clear'}]);
});
