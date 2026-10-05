// SPDX-License-Identifier: GPL-3.0-or-later
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');

class SystemMedia {
 constructor(executable, onCommand, onError, {spawnImpl = spawn, restartDelays = [1000, 3000, 10000]} = {}) {
  Object.assign(this, {executable, onCommand, onError, spawnImpl, restartDelays});
  this.ready = false;
  this.restarts = 0;
  this.snapshot = null;
  this.start();
 }

 start() {
  if (this.closing) return;
  const child = this.process = this.spawnImpl(this.executable, [], {windowsHide:true, stdio:['pipe','pipe','pipe']});
  this.ready = false;
  this.blocked = false;
  // A new SMTC owner must receive the complete current track, including its cover.
  if (this.snapshot) { this.pendingUpdate = {...this.snapshot, artChanged:true}; this.pendingPosition = undefined; }
  this.reader = createInterface({input:child.stdout});
  this.reader.on('line', line => {
   if (this.closing || this.process !== child) return;
   let message;
   try { message = JSON.parse(line); } catch { return; }
   if (!message || typeof message !== 'object') return;
   if (message.type === 'ready') { this.ready = true; this.flush(); }
   else if (message.type === 'command') this.onCommand(message);
   else if (message.type === 'error') this.onError(message.reason);
  });
  let error = '', ended = false;
  child.stderr.on('data', data => { error = (error + data).slice(-300); });
  const stopped = reason => {
   if (ended || this.process !== child) return;
   ended = true;
   this.ready = false;
   this.reader.close();
   if (this.closing) return;
   this.onError(reason);
   if (this.restarts < this.restartDelays.length) {
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.start(); }, this.restartDelays[this.restarts++]);
    this.restartTimer.unref?.();
   }
  };
  child.stdin.on('error', () => { stopped('系统媒体桥接管道已断开'); child.kill(); });
  child.stdin.on('drain', () => { if (this.process === child) { this.blocked = false; this.flush(); } });
  child.on('error', () => stopped('系统媒体桥接无法启动'));
  child.on('exit', () => stopped(error || '系统媒体桥接已退出'));
 }

 write(message) {
  if (!this.process.stdin.writable || this.process.stdin.destroyed) return false;
  this.blocked = !this.process.stdin.write(JSON.stringify(message) + '\n');
  return true;
 }

 flush() {
  if (this.closing || !this.ready || this.blocked) return;
  // Keep only the latest state while the bridge is busy. Progress or lyric updates
  // must never evict the only metadata/cover update or grow an unbounded pipe queue.
  if (this.pendingClear) {
   if (!this.write({command:'clear'})) return;
   this.pendingClear = false;
  }
  if (this.blocked) return;
  if (this.pendingUpdate) {
   if (!this.write(this.pendingUpdate)) return;
   this.pendingUpdate = null;
  }
  if (this.blocked) return;
  if (this.pendingPosition !== undefined) {
   if (!this.write({command:'position', positionMs:this.pendingPosition})) return;
   this.pendingPosition = undefined;
  }
 }

 update(state, artChanged) {
  if (this.closing) return;
  const artwork = artChanged ? (state.artwork?.length ? Buffer.from(state.artwork).toString('base64') : '') : this.snapshot?.artwork || '';
  const coverPending = !!artChanged || !!this.pendingUpdate?.artChanged;
  this.snapshot = {...state, command:'update', artwork};
  this.pendingUpdate = {...this.snapshot, artChanged:coverPending, artwork:coverPending ? artwork : ''};
  this.pendingPosition = undefined;
  this.flush();
 }

 position(positionMs) {
  if (this.closing || !this.snapshot) return;
  this.snapshot.positionMs = positionMs;
  if (this.pendingUpdate) this.pendingUpdate.positionMs = positionMs;
  else this.pendingPosition = positionMs;
  this.flush();
 }

 clear() {
  if (this.closing) return;
  this.snapshot = null;
  this.pendingUpdate = null;
  this.pendingPosition = undefined;
  this.pendingClear = true;
  this.flush();
 }

 close() {
  if (this.closing) return;
  this.closing = true;
  clearTimeout(this.restartTimer);
  this.reader?.close();
  const child = this.process;
  if (child.stdin.writable && !child.stdin.destroyed) child.stdin.end(JSON.stringify({command:'stop'}) + '\n');
  setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500).unref();
 }
}
module.exports = {SystemMedia};
