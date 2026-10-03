const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY = 'https://github.com/Roylyl/WinPlay';
const API = 'https://api.github.com/repos/Roylyl/WinPlay/releases?per_page=100';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(value) {
  if (typeof value !== 'string' || !VERSION.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareVersions(a, b) {
  const aa = versionParts(a), bb = versionParts(b);
  if (!aa || !bb) return null;
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
function safeLink(value, expectedPath) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
        url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) return null;
    return url.href;
  } catch { return null; }
}
function tagVersion(tag) {
  if (typeof tag !== 'string') return null;
  const match = /^(?:[Vv]|WinPlay-)?(.+)$/.exec(tag);
  return match && versionParts(match[1]) ? match[1] : null;
}
function releasePage(tag, rawPage) {
  const pagePath = `/Roylyl/WinPlay/releases/tag/${tag}`;
  return safeLink(rawPage, pagePath) || `https://github.com${pagePath}`;
}
function installerLink(version, tag, assets) {
  if (!Array.isArray(assets)) return null;
  const name = `WinPlay-${version}-Setup-x64.exe`;
  const asset = assets.find(item => item && item.name === name &&
    safeLink(item.browser_download_url, `/Roylyl/WinPlay/releases/download/${tag}/${name}`));
  return asset ? safeLink(asset.browser_download_url, `/Roylyl/WinPlay/releases/download/${tag}/${name}`) : null;
}
function validCachedRelease(raw, current) {
  if (!raw || compareVersions(raw.version, current) !== 1) return null;
  const tag = raw.tag === undefined ? `WinPlay-${raw.version}` : raw.tag;
  if (tagVersion(tag) !== raw.version) return null;
  const name = `WinPlay-${raw.version}-Setup-x64.exe`;
  return {
    version: raw.version,
    tag,
    page: releasePage(tag, raw.page),
    installer: safeLink(raw.installer, `/Roylyl/WinPlay/releases/download/${tag}/${name}`)
  };
}
async function readLimitedJSON(response, signal) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('response-too-large');
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('invalid-response');
  const reader = response.body.getReader();
  const buffers = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('request-timeout');
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('response-too-large');
      buffers.push(Buffer.from(value));
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* The request may already be aborted. */ }
    throw error;
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(buffers, bytes).toString('utf8'));
}

class Updates {
  constructor({version, dataDir, onChange = () => {}, fetchImpl = globalThis.fetch}) {
    if (!versionParts(version)) throw new Error('WinPlay版本格式无效');
    if (typeof fetchImpl !== 'function') throw new Error('更新检查不可用');
    this.version = version;
    this.cachePath = path.join(dataDir, 'updates.json');
    this.onChange = onChange;
    this.fetchImpl = fetchImpl;
    this._flight = null;
    let cached = {};
    try {
      if (fs.statSync(this.cachePath).size <= MAX_CACHE_BYTES) cached = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch { /* A missing or invalid optional cache does not block startup. */ }
    if (!cached || typeof cached !== 'object') cached = {};
    const now = Date.now();
    this.lastCheck = Number.isFinite(cached.lastCheck) && cached.lastCheck >= 0 && cached.lastCheck <= now ? cached.lastCheck : 0;
    this.notifiedVersion = versionParts(cached.notifiedVersion) ? cached.notifiedVersion : null;
    const release = validCachedRelease(cached.release, version);
    this._state = {
      checking: false,
      automatic: typeof cached.automatic === 'boolean' ? cached.automatic : true,
      status: release ? '发现新版本' : '尚未检查更新',
      detail: release ? release.version : '',
      release
    };
  }

  state() { return {...this._state, release: this._state.release ? {...this._state.release} : null}; }
  _changed() { try { this.onChange(this.state()); } catch { /* UI listeners cannot interrupt the check. */ } }
  _save() {
    const temporary = `${this.cachePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), {recursive: true});
      fs.writeFileSync(temporary, JSON.stringify({
        automatic: this._state.automatic, lastCheck: this.lastCheck,
        notifiedVersion: this.notifiedVersion, release: this._state.release
      }), 'utf8');
      fs.renameSync(temporary, this.cachePath);
    } catch { /* Optional persistence failures must not prevent use of the app. */ }
  }
  setAutomatic(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('自动更新设置无效');
    this._state.automatic = enabled;
    this._save();
    this._changed();
    return enabled ? this.check({automatic: true}) : Promise.resolve(this.state());
  }
  shouldNotify() {
    return !!this._state.release && this.notifiedVersion !== this._state.release.version;
  }
  markNotified() {
    if (!this._state.release) return;
    this.notifiedVersion = this._state.release.version;
    this._save();
  }
  releaseUrl() { return this._state.release?.page || `${REPOSITORY}/releases`; }
  downloadUrl() { return this._state.release?.installer || this.releaseUrl(); }

  // Returning the existing Promise merges concurrent manual/background requests.
  check({automatic = false} = {}) {
    if (this._flight) return this._flight;
    if (automatic && (!this._state.automatic || Date.now() - this.lastCheck < DAY_MS)) return Promise.resolve(this.state());
    this.lastCheck = Date.now();
    this._save();
    this._state.checking = true;
    this._state.status = '正在检查更新…';
    this._state.detail = '';
    // Start after assigning _flight so callbacks cannot trigger a second request.
    this._flight = Promise.resolve().then(() => this._perform()).finally(() => {
      this._state.checking = false;
      this._flight = null;
      this._save();
      this._changed();
    }).then(() => this.state());
    this._changed();
    return this._flight;
  }
  async _perform() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(API, {
        signal: controller.signal, redirect: 'error',
        headers: {'Accept': 'application/vnd.github+json', 'User-Agent': `WinPlay/${this.version}`, 'X-GitHub-Api-Version': '2022-11-28'}
      });
      if (response.status !== 200) throw new Error(`github-http-${response.status}`);
      const raw = await readLimitedJSON(response, controller.signal);
      if (!Array.isArray(raw)) throw new Error('invalid-response');
      const releases = raw.slice(0, 100).flatMap(item => {
        if (!item || item.draft !== false || item.prerelease !== false) return [];
        const tag = item.tag_name, version = tagVersion(tag);
        if (!version) return [];
        return [{version, tag, page: releasePage(tag, item.html_url), installer: installerLink(version, tag, item.assets)}];
      });
      releases.sort((a, b) => compareVersions(b.version, a.version) || Number(!!b.installer) - Number(!!a.installer));
      const latest = releases[0];
      if (!latest) {
        this._state.status = '未找到正式发行版';
        this._state.release = null;
      } else if (compareVersions(latest.version, this.version) !== 1) {
        this._state.status = '当前已是最新版本';
        this._state.release = null;
      } else {
        this._state.status = '发现新版本';
        this._state.detail = latest.version;
        this._state.release = latest;
      }
    } catch (error) {
      // Keep the last valid release available even when GitHub is unreachable.
      this._state.status = '检查更新失败';
      if (controller.signal.aborted || error?.name === 'AbortError' || error?.message === 'request-timeout') this._state.detail = '请求超时，请稍后重试';
      else if (/^github-http-\d+$/.test(error?.message || '')) this._state.detail = `GitHub HTTP${error.message.slice('github-http-'.length)}`;
      else if (error?.message === 'response-too-large') this._state.detail = '发行信息过大，请查看发行说明';
      else this._state.detail = '无法读取GitHub发行信息，请稍后重试';
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

module.exports = {Updates};
