const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {connectProbeRequest, interfaceScope, Discovery} = require('../build/engine/discovery');
const service = '_carplay-ctrl._tcp.local', instance = 'Test Phone.' + service, host = 'test-phone.local';
const record = (name, type, data, ttl = 120) => ({name, type, data, ttl});
const ipv4 = {address:'192.0.2.2', family:'IPv4', internal:false, mac:'02:00:00:00:00:01', netmask:'255.255.255.0', cidr:'192.0.2.2/24'};
const ipv6 = {address:'fe80::1', family:'IPv6', scopeid:12, internal:false, mac:ipv4.mac, netmask:'ffff:ffff:ffff:ffff::', cidr:'fe80::1/64'};

function harness(t, addresses = [ipv4, ipv6]) {
 const sockets = [], connections = [], messages = [], scheduled = new Map();
 let clock = 10000, authenticated = true;
 class Multicast extends EventEmitter {
  constructor(options) { super(); this.options = options; this.queries = []; this.responses = []; }
  query(packet, callback) { this.queries.push(...packet.questions); callback?.(null); }
  respond(packet, callback) { this.responses.push(packet); callback?.(null); }
  destroy() { this.destroyed = true; }
 }
 class Connection extends EventEmitter {
  constructor(options) { super(); this.options = options; this.writes = []; }
  setTimeout(ms, callback) { this.timeout = {ms, callback}; }
  write(value) { this.writes.push(value); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
 }
 const discovery = new Discovery('WLAN', {deviceId:ipv4.mac, pk:'test-public-key', pi:'test-pairing', btMac:ipv4.mac}, '02:00:00:00:00:02', () => authenticated, value => messages.push(value), {
  interfaces:() => ({WLAN:addresses}), now:() => clock,
  mdns:options => { const socket = new Multicast(options); sockets.push(socket); return socket; },
  connect:options => { const socket = new Connection(options); connections.push(socket); return socket; },
  setTimeout:(callback, delay) => { const token = {}; scheduled.set(token, {callback, delay}); return token; },
  clearTimeout:token => scheduled.delete(token)
 });
 t.after(() => discovery.destroy());
 sockets.forEach(socket => socket.emit('ready'));
 return {
  discovery, sockets, connections, messages, scheduled,
  receive:answers => sockets[0].emit('response', {answers}),
  advance:ms => { clock += ms; discovery.resolve(); },
  authenticate:value => { authenticated = value; },
  retry:() => { const [token, item] = scheduled.entries().next().value; scheduled.delete(token); clock += item.delay; item.callback(); }
 };
}

test('CarPlay control probe strips IPv6 scope and preserves receiver identity', () => {
 const request = connectProbeRequest('fe80::2%15', 7000, '02:00:00:00:00:01');
 assert.equal(request, 'GET /ctrl-int/1/connect HTTP/1.1\r\nHost: [fe80::2]:7000\r\nUser-Agent: AirPlay/950.7.1\r\nAirPlay-Receiver-Device-ID: 020000000001\r\nConnection: close\r\n\r\n');
 assert.throws(() => connectProbeRequest('fe80::2\r\nInjected: x', 7000, '02:00:00:00:00:01'));
});

test('PTR-only answers trigger SRV/TXT resolution and then A/AAAA lookup', t => {
 const h = harness(t);
 h.authenticate(false);
 h.receive([record(service, 'PTR', instance)]);
 for (const type of ['SRV', 'TXT']) assert.ok(h.sockets[0].queries.some(query => query.type === type && query.name.toLowerCase() === instance.toLowerCase()));
 h.receive([record(instance, 'SRV', {target:host, port:7000})]);
 for (const type of ['A', 'AAAA']) assert.ok(h.sockets[0].queries.some(query => query.type === type && query.name === host));
 h.receive([record(host, 'AAAA', 'fe80::2')]);
 assert.equal(h.connections.length, 0, 'resolves before authentication without probing');
 h.authenticate(true);
 h.advance(1);
 assert.equal(h.connections.length, 1, 'missing TXT retains the old permissive target policy');
 assert.deepEqual(h.connections[0].options, {host:'fe80::2%12', port:7000, localAddress:'fe80::1%12'});
 const count = h.sockets[0].queries.length;
 h.receive([record(service, 'PTR', instance)]);
 assert.equal(h.sockets[0].queries.length, count, 'duplicate packets do not flood supplementary queries');
 assert.equal(h.connections.length, 1, 'in-flight endpoints are not probed twice');
});

test('keeps all addresses and ignores global/ULA IPv6 without replacing link-local', t => {
 const h = harness(t);
 h.receive([
  record(instance, 'SRV', {target:host, port:7000}),
  record(host, 'AAAA', 'fe80::2'), record(host, 'AAAA', 'fd00::2'), record(host, 'AAAA', '2001:db8::2'),
  record(host, 'A', '192.0.2.3'), record(host, 'A', '192.0.2.4')
 ]);
 assert.deepEqual(h.connections.map(socket => socket.options.host), ['fe80::2%12'], 'prefers link-local and avoids competing requests');
 assert.equal(h.discovery.matching(host, 'A').length, 2);
 assert.equal(h.discovery.matching(host, 'AAAA').length, 3);
 h.receive([record(host, 'AAAA', 'fd00::2', 0)]);
 assert.deepEqual(h.discovery.matching(host, 'AAAA').map(item => item.data), ['fe80::2', '2001:db8::2']);
 assert.equal(h.connections.length, 1);
});

test('mismatched TXT ID prevents probing while still resolving the host', t => {
 const h = harness(t);
 h.receive([record(instance, 'SRV', {target:host, port:7000}), record(instance, 'TXT', [Buffer.from('id=02:00:00:00:00:99')])]);
 assert.ok(h.sockets[0].queries.some(query => query.name === host && query.type === 'AAAA'));
 h.receive([record(host, 'AAAA', 'fe80::2')]);
 assert.equal(h.connections.length, 0);
 h.receive([record(instance, 'TXT', [Buffer.from('id=02:00:00:00:00:02')])]);
 assert.equal(h.connections.length, 1);
});

test('validates scope and uses wildcard IPv4 binding with an explicit multicast interface', t => {
 assert.equal(interfaceScope('fe80::1', 12), 12);
 assert.equal(interfaceScope('fe80::1%15', 0), 15);
 for (const [address, scope] of [['fe80::1', undefined], ['fe80::1%undefined', undefined], ['fe80::1%0', 0], ['fe80::1', -1], ['fe80::1', 1.5], ['fe80::1', 0x100000000]]) assert.equal(interfaceScope(address, scope), undefined);
 const h = harness(t, [ipv4, {...ipv6, scopeid:0}]);
 assert.equal(h.sockets.length, 1);
 assert.equal(h.sockets[0].options.bind, '0.0.0.0');
 assert.equal(h.sockets[0].options.interface, ipv4.address);
 h.receive([record(instance, 'SRV', {target:host, port:7000}), record(host, 'AAAA', 'fe80::2')]);
 assert.equal(h.connections.length, 0);
 assert.ok(h.messages.some(value => value.includes('作用域无效')));
});

test('diagnostics expose bounded stages/error codes and coalesce repeated warnings', t => {
 const h = harness(t);
 for (let i = 0; i < 12; i++) h.sockets[0].emit('warning', {code:'EINVAL', message:'private Wi-Fi name 192.0.2.3 phone 02:00:00:00:00:02'});
 assert.equal(h.messages.filter(value => value.includes('EINVAL')).length, 1);
 assert.ok(h.messages.every(value => value.startsWith('网络发现：')));
 assert.ok(h.messages.every(value => !/192\.0\.2\.|fe80::|Test Phone|test-phone|test-public|test-pairing|02:00:00|private Wi-Fi/.test(value)));
 h.receive([{name:instance, type:'SRV', ttl:120, data:{target:host, port:0}}, {name:host, type:'AAAA', ttl:120, data:'fe80::2%undefined'}, {name:instance, type:'TXT', ttl:120, data:['not-a-buffer']}]);
 assert.equal(h.connections.length, 0, 'malformed records are ignored');
});

test('retries unsuccessful HTTP, succeeds once and cancels queued retries on destroy', t => {
 const h = harness(t, [ipv4]);
 h.receive([record(instance, 'SRV', {target:host, port:7000}), record(host, 'A', '192.0.2.3')]);
 h.connections[0].emit('connect');
 assert.ok(h.connections[0].writes[0].startsWith('GET /ctrl-int/1/connect HTTP/1.1'));
 h.connections[0].emit('data', Buffer.from('HTTP/1.1 503 Service Unavailable\r\n'));
 assert.equal(h.scheduled.size, 1);
 h.retry();
 assert.equal(h.connections.length, 2);
 h.connections[1].emit('data', Buffer.from('HTTP/1.1 200 OK\r\n'));
 assert.equal(h.scheduled.size, 0);
 h.advance(5000);
 assert.equal(h.connections.length, 2);
 const waiting = harness(t, [ipv4]);
 waiting.receive([record(instance, 'SRV', {target:host, port:7000}), record(host, 'A', '192.0.2.3')]);
 waiting.connections[0].emit('error', {code:'ECONNREFUSED'});
 waiting.connections[0].destroy();
 assert.equal(waiting.scheduled.size, 1);
 waiting.discovery.destroy();
 assert.equal(waiting.scheduled.size, 0);
 assert.ok(waiting.sockets[0].destroyed);
 const messagesBefore = waiting.messages.length, queriesBefore = waiting.sockets[0].queries.length;
 waiting.sockets[0].emit('ready');
 assert.equal(waiting.messages.length, messagesBefore);
 assert.equal(waiting.sockets[0].queries.length, queriesBefore, 'late ready after stop cannot restart queries');
});

test('retains multiple PTR instances and immediately falls back after the first IPv6 failure', t => {
 const h = harness(t);
 h.receive([record(service, 'PTR', instance), record(service, 'PTR', 'Other Phone.' + service)]);
 assert.equal(h.discovery.matching(service, 'PTR').length, 2);
 h.receive([record(instance, 'SRV', {target:host, port:7000}), record(host, 'AAAA', 'fe80::2'), record(host, 'A', '192.0.2.3')]);
 h.connections[0].emit('error', {code:'EHOSTUNREACH'});
 h.connections[0].destroy();
 assert.equal(h.connections.at(-1).options.host, '192.0.2.3');
 assert.equal(h.connections.length, 2);
 h.retry();
 assert.equal(h.connections.length, 2, 'IPv6 retry cannot compete with in-flight IPv4');
 h.connections[1].emit('data', Buffer.from('HTTP/1.1 200 OK\r\n'));
 h.advance(30001);
 assert.equal(h.connections.length, 2, 'successful fallback prevents duplicate connect requests');
});

test('single unreachable endpoint has seven bounded retries and later may start a fresh round', t => {
 const h = harness(t, [ipv4]);
 h.receive([record(instance, 'SRV', {target:host, port:7000}), record(host, 'A', '192.0.2.3')]);
 for (let attempt = 0; attempt < 7; attempt++) {
  h.connections.at(-1).emit('error', {code:'ECONNREFUSED'});
  h.connections.at(-1).destroy();
  if (attempt < 6) h.retry();
 }
 assert.equal(h.connections.length, 7);
 assert.equal(h.scheduled.size, 0);
 assert.equal(h.messages.filter(value => value === 'iPhone控制服务探测失败，请检查无线网络与防火墙').length, 1);
 h.advance(30001);
 assert.equal(h.connections.length, 8, 'failed endpoints are not suppressed forever');
});
