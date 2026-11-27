'use strict';

const net = require('node:net');
const { identification, fields, param, str, u16, u32, csm } = require('../../build/engine/iap');

function messageIds(bytes) {
  const ids = [];
  for (let i = 0; i < bytes.length; i += 2) ids.push(bytes.readUInt16BE(i));
  return ids;
}

function wiredIdentity(config, usbMuxInterface) {
  if (!Number.isInteger(usbMuxInterface) || usbMuxInterface < 0 || usbMuxInterface > 255) {
    throw new Error('Expected the USBMUX interface from the active USB configuration.');
  }
  const attrs = fields(identification(config).subarray(6));
  attrs.delete(17); // Bluetooth transport
  attrs.delete(24); // Wireless CarPlay transport
  const sent = messageIds(attrs.get(6)).filter(id => id !== 0x5703 && id !== 0xae03);
  const received = messageIds(attrs.get(7)).filter(id => ![0x5702, 0x4e0d, 0x4e0e].includes(id));
  attrs.set(6, Buffer.concat([...sent, 0xae03].map(u16)));
  attrs.set(7, Buffer.concat(received.map(u16)));
  attrs.set(8, Buffer.from([2]));
  attrs.set(16, Buffer.concat([
    param(0, u16(0)), param(1, str('USBHostTransport')), param(2),
    param(3, Buffer.from([usbMuxInterface])), param(4)
  ]));
  return csm(0x1d01, [...attrs].sort(([first], [second]) => first - second).map(([id, bytes]) => param(id, bytes)));
}

function wiredStartSession({ address, port, mac, publicKey }) {
  if (net.isIP(address) !== 6 || address.includes('%') || !/^fe[89ab][a-f0-9]:/i.test(address)) throw new Error('Expected an unscoped link-local USB address.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid USB listener port.');
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) throw new Error('Invalid USB adapter MAC.');
  if (typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/i.test(publicKey)) throw new Error('Expected the receiver public key in hexadecimal.');
  return csm(0x4301, [
    param(0, param(0, str(address))), param(2, u32(port)), param(3, str(mac.toUpperCase())),
    param(4, str(publicKey.toLowerCase())), param(5, str('950.7.1'))
  ]);
}

module.exports = { wiredIdentity, wiredStartSession };
