const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Updates} = require('../src/updates.cjs');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winplay-updates-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function release(version, extra = {}) {
  const name = `WinPlay-${version}-Setup-x64.exe`;
  return {
    tag_name: `WinPlay-${version}`, html_url: `https://github.com/Roylyl/WinPlay/releases/tag/WinPlay-${version}`,
    draft: false, prerelease: false,
    assets: [{name, browser_download_url: `https://github.com/Roylyl/WinPlay/releases/download/WinPlay-${version}/${name}`}],
    ...extra
  };
}
function response(items) { return new Response(JSON.stringify(items), {status: 200}); }

test('uses only WinPlay releases, compares numeric versions and excludes nonstable tags', async t => {
  const changes = [], calls = [];
  const updates = new Updates({version: '1.1.0', dataDir: directory(t), onChange: state => changes.push(state), fetchImpl: async (url, options) => {
    calls.push({url, options});
    return response([release('1.9.9'), release('1.10.0'), release('9.0.0', {prerelease: true}), release('8.0.0', {draft: true}), release('7.0.0', {tag_name: 'MacPlay-7.0.0'}), release('6.0.0', {tag_name: 'WinPlay-6.0.0-beta.1'}), release('5.0.0', {tag_name: 'WinPlay-05.0.0'})]);
  }});
  assert.equal(calls.length, 0, 'construction does not start a request');
  assert.equal(updates.state().automatic, true);
  const state = await updates.check();
  assert.equal(state.release.version, '1.10.0');
  assert.equal(state.status, '发现新版本');
  assert.equal(state.checking, false);
  assert.equal(calls[0].url, 'https://api.github.com/repos/Roylyl/WinPlay/releases?per_page=100');
  assert.equal(calls[0].options.headers['User-Agent'], 'WinPlay/1.1.0');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(changes[0].checking, true);
  assert.equal(changes.at(-1).checking, false);
  state.release.version = '99.0.0';
  assert.equal(updates.state().release.version, '1.10.0', 'state snapshots cannot mutate the module');
});

test('merges concurrent checks, persists daily throttle and allows manual retry', async t => {
  let finish, calls = 0;
  const dir = directory(t);
  const updates = new Updates({version: '1.1.0', dataDir: dir, fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); }});
  const first = updates.check({automatic: true});
  assert.equal(updates.check(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(response([release('1.2.0')]));
  await first;
  await updates.check({automatic: true});
  assert.equal(calls, 1);
  const restored = new Updates({version: '1.1.0', dataDir: dir, fetchImpl: async () => { calls++; return response([release('1.3.0')]); }});
  await restored.check({automatic: true});
  assert.equal(calls, 1, 'restart retains the automatic interval');
  await restored.check();
  assert.equal(calls, 2, 'manual check bypasses the automatic interval');
  await restored.setAutomatic(false);
  assert.equal(restored.state().automatic, false);
  await restored.check({automatic: true});
  assert.equal(calls, 2);
  assert.equal(new Updates({version: '1.1.0', dataDir: dir}).state().automatic, false);
});

test('notifies once per version and retains safe links after failed requests', async t => {
  const dir = directory(t);
  let fail = false;
  const updates = new Updates({version: '1.1.0', dataDir: dir, fetchImpl: async () => fail ? new Response('', {status: 403}) : response([release('1.2.0')])});
  await updates.check();
  assert.equal(updates.shouldNotify(), true);
  updates.markNotified();
  assert.equal(updates.shouldNotify(), false);
  const restored = new Updates({version: '1.1.0', dataDir: dir});
  assert.equal(restored.shouldNotify(), false);
  assert.equal(restored.downloadUrl(), 'https://github.com/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe');
  fail = true;
  await updates.check();
  assert.equal(updates.state().status, '检查更新失败');
  assert.equal(updates.state().detail, 'GitHub HTTP403');
  assert.equal(updates.state().release.version, '1.2.0');
  assert.equal(updates.shouldNotify(), false);
  const upgraded = new Updates({version: '1.2.0', dataDir: dir});
  assert.equal(upgraded.state().release, null, 'old cached update is removed after upgrade');
});

test('requires exact x64 EXE from this repository and falls back to the release page', async t => {
  const malicious = [
    'https://evil.example/WinPlay-1.2.0-Setup-x64.exe',
    'https://github.com/Roylyl/MacPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe',
    'https://github.com.evil.example/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe',
    'http://github.com/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe',
    'https://user:password@github.com/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe',
    'https://github.com/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-x64.exe?redirect=evil'
  ];
  for (const browser_download_url of malicious) {
    const updates = new Updates({version: '1.1.0', dataDir: directory(t), fetchImpl: async () => response([release('1.2.0', {html_url: 'https://evil.example/', assets: [{name: 'WinPlay-1.2.0-Setup-x64.exe', browser_download_url}]})])});
    await updates.check();
    assert.equal(updates.state().release.installer, null);
    assert.equal(updates.releaseUrl(), 'https://github.com/Roylyl/WinPlay/releases/tag/WinPlay-1.2.0');
    assert.equal(updates.downloadUrl(), updates.releaseUrl());
  }
  const updates = new Updates({version: '1.1.0', dataDir: directory(t), fetchImpl: async () => response([release('1.2.0', {assets: [{name: 'WinPlay-1.2.0-Setup-arm64.exe', browser_download_url: 'https://github.com/Roylyl/WinPlay/releases/download/WinPlay-1.2.0/WinPlay-1.2.0-Setup-arm64.exe'}]})])});
  await updates.check();
  assert.equal(updates.state().release.installer, null);
});

test('bounds response size and handles malformed JSON/timeout without exposing error details', async t => {
  const cases = [
    {fetchImpl: async () => new Response('[]', {headers: {'content-length': String(5 * 1024 * 1024)}}), detail: '发行信息过大，请查看发行说明'},
    {fetchImpl: async () => new Response('a'.repeat(4 * 1024 * 1024 + 1)), detail: '发行信息过大，请查看发行说明'},
    {fetchImpl: async () => new Response('not-json'), detail: '无法读取GitHub发行信息，请稍后重试'},
    {fetchImpl: async () => { throw Object.assign(new Error('private local details'), {name: 'AbortError'}); }, detail: '请求超时，请稍后重试'}
  ];
  for (const item of cases) {
    let calls = 0;
    const updates = new Updates({version: '1.1.0', dataDir: directory(t), fetchImpl: (...args) => { calls++; return item.fetchImpl(...args); }});
    await updates.check({automatic: true});
    assert.equal(updates.state().status, '检查更新失败');
    assert.equal(updates.state().detail, item.detail);
    assert.equal(updates.state().checking, false);
    await updates.check({automatic: true});
    assert.equal(calls, 1, 'automatic failures are also throttled');
  }
});

test('same version is current, missing stable releases are explicit and invalid cache is ignored', async t => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'updates.json'), JSON.stringify({automatic: 'wrong', lastCheck: Date.now() + 86400000, notifiedVersion: 'broken', release: {version: '1.2.0', page: 'javascript:alert(1)', installer: 'file:///C:/private.exe'}}));
  const updates = new Updates({version: '1.1.0', dataDir: dir, fetchImpl: async () => response([release('1.1.0')])});
  assert.equal(updates.state().automatic, true);
  assert.equal(updates.state().release.installer, null);
  assert.equal(updates.releaseUrl(), 'https://github.com/Roylyl/WinPlay/releases/tag/WinPlay-1.2.0');
  await updates.check({automatic: true});
  assert.equal(updates.state().status, '当前已是最新版本');
  assert.equal(updates.state().release, null);
  assert.equal(updates.shouldNotify(), false);
  assert.equal(updates.downloadUrl(), 'https://github.com/Roylyl/WinPlay/releases');
  const empty = new Updates({version: '1.1.0', dataDir: directory(t), fetchImpl: async () => response([release('1.2.0', {prerelease: true})])});
  await empty.check();
  assert.equal(empty.state().status, '未找到正式发行版');
  assert.equal(empty.state().release, null);
});
