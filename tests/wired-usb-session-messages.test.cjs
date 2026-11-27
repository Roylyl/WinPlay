'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wiredIdentity, wiredStartSession } = require('../src/wired/session-messages.cjs');
const { fields } = require('../build/engine/iap');

const device = { serial: 'TEST', ssid: '', btMac: '' };
const readIds = bytes => Array.from({length: bytes.length / 2}, (_, i) => bytes.readUInt16BE(i * 2));

test('wired identification uses the active USBMUX interface and advertises the USB host capabilities', () => {
  for (const mux of [0, 1, 7]) {
    const message = wiredIdentity(device, mux);
    const params = fields(message.subarray(6));
    assert.equal(message.readUInt16BE(4), 0x1d01);
    assert.equal(params.get(1).toString(), 'WinPlay\0');
    assert.equal(params.has(17) || params.has(24), false);
    const host = fields(params.get(16));
    assert.equal(host.get(3).readUInt8(), mux);
    assert.equal(host.has(4), true);
    const sent = readIds(params.get(6)), received = readIds(params.get(7));
    assert(sent.includes(0xae03) && sent.includes(0x4301));
    assert(received.includes(0x4300));
    assert(!sent.includes(0x5703) && !received.includes(0x5702));
  }
  assert.throws(() => wiredIdentity(device, undefined), /USBMUX/);
});

test('USB start advertises the listener and the receiver public key separately from its pairing identifier', () => {
  const endpoint = { address: 'fe80::1234', mac: '02:00:00:00:00:01', publicKey: 'ab'.repeat(32), port: 17000 };
  const message = wiredStartSession(endpoint);
  assert.equal(message.readUInt16BE(4), 0x4301);
  const params = fields(message.subarray(6));
  assert.equal(fields(params.get(0)).get(0).toString(), endpoint.address + '\0');
  assert.equal(params.has(1), false);
  assert.equal(params.get(2).readUInt32BE(), endpoint.port);
  assert.equal(params.get(3).toString(), endpoint.mac + '\0');
  assert.equal(params.get(4).toString(), endpoint.publicKey + '\0');
  assert.throws(() => wiredStartSession({...endpoint, publicKey:'00000000-0000-0000-0000-000000000001'}), /public key/);
  assert.throws(() => wiredStartSession({...endpoint, address:'fe80::1%5'}), /unscoped/);
});
