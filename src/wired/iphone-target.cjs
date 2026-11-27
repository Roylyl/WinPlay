'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const {createHash} = require('node:crypto');
const plist = require('plist');
const { nativePath } = require('./native-path.cjs');

const parentPattern = /^USB\\VID_05AC&PID_([0-9a-f]{4})\\([^\\*?\x00-\x1f]+)$/i;
const explicit = 'Specify the intended phone with --parent-instance.';
const maxMessage = 1024 * 1024;

async function listAppleParents() {
  try {
    const {stdout}=await promisify(execFile)(nativePath('WinPlay.UsbTopology.exe'),['--parents'],
      {encoding:'utf8',windowsHide:true,timeout:2500});
    return JSON.parse(stdout);
  } catch {
    throw new Error('Windows could not enumerate Apple USB parents.');
  }
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]+$/i.test(value)) return '';
  return value.replaceAll('-', '').toUpperCase();
}

function family(product) {
  if (typeof product !== 'string') return null;
  if (/^(?:Apple )?iPhone(?:$| [^\r\n]+$)|^iPhone[0-9]+,[0-9]+$/i.test(product)) return 'iphone';
  if (/^(?:Apple )?(?:iPad|iPod|Watch|AppleTV|Apple TV|HomePod|AudioAccessory)(?:$| |[0-9])/i.test(product)) return 'other';
  return null;
}

function usbMuxRequest(socket, command, options = {}) {
  const body = Buffer.from(plist.build({ MessageType: command, ClientVersionString: 'WinPlay', ProgName: 'WinPlay',
    kLibUSBMuxVersion: 3, ...options }));
  const header = Buffer.alloc(16);
  [body.length+16,1,8,1].forEach((n,i) => header.writeUInt32LE(n,i*4));
  socket.write(Buffer.concat([header,body]));
}

async function localAppleService(exchange) {
  const socket = net.connect(27015, '127.0.0.1');
  const timeout = setTimeout(() => socket.destroy(new Error('Apple USB service timed out.')), 5000);
  const stream = socket[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  async function read(n) {
    if (!Number.isInteger(n) || n < 0 || n > maxMessage) throw new Error('Invalid Apple USB message length.');
    while (buffered.length < n) {
      const chunk = await stream.next();
      if (chunk.done) throw new Error('Apple USB service closed the connection.');
      buffered = Buffer.concat([buffered,chunk.value]);
    }
    const result = buffered.subarray(0,n);
    buffered = buffered.subarray(n);
    return result;
  }
  async function muxReply() {
    const header = await read(16);
    if (header.readUInt32LE(4) !== 1 || header.readUInt32LE(8) !== 8) throw new Error('Unexpected USBMUX response.');
    return plist.parse((await read(header.readUInt32LE()-16)).toString('utf8'));
  }
  try { return await exchange(socket, read, muxReply); }
  finally { clearTimeout(timeout); socket.destroy(); }
}

async function listAttached(parents) {
  const needed = new Set(parents.map(parent => identifier(parentPattern.exec(parent.parentInstance)[2])));
  return localAppleService(async (socket, _read, muxReply) => {
    usbMuxRequest(socket, 'Listen');
    const attached = new Map();
    while (true) {
      const msg = await muxReply();
      if (msg.MessageType === 'Result' && msg.Number !== 0) throw new Error('Apple USB device notifications are unavailable.');
      if (msg.MessageType === 'Detached') attached.delete(msg.DeviceID);
      if (msg.MessageType !== 'Attached' || msg.Properties?.ConnectionType !== 'USB') continue;
      const id = identifier(msg.Properties.SerialNumber);
      if (!id || !needed.has(id)) continue;
      attached.set(msg.DeviceID, msg);
      const seen = new Set([...attached.values()].map(m => identifier(m.Properties.SerialNumber)));
      if ([...needed].every(item => seen.has(item))) return [...attached.values()];
    }
  });
}

async function readProductType(deviceId) {
  return localAppleService(async (socket, read, muxReply) => {
    // The local mux Connect message carries the port in network byte order.
    const port = Buffer.alloc(2); port.writeUInt16BE(62078);
    usbMuxRequest(socket, 'Connect', { DeviceID: deviceId, PortNumber: port.readUInt16LE() });
    const reply = await muxReply();
    if (reply.MessageType !== 'Result' || reply.Number !== 0) throw new Error('USB product identification is unavailable.');
    const body = Buffer.from(plist.build({ Label: 'WinPlay', Request: 'GetValue', Key: 'ProductType' }));
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    socket.write(Buffer.concat([header,body]));
    const response = plist.parse((await read((await read(4)).readUInt32BE())).toString('utf8'));
    return response.Request === 'GetValue' && !response.Error ? response.Value : null;
  });
}

async function listUsbIphones({ parents = listAppleParents, attached = listAttached, productType = readProductType } = {}) {
  const candidates = (await parents()).filter(p => parentPattern.test(p.parentInstance) && family(p.product) !== 'other');
  if (!candidates.length) throw new Error('No USB iPhone found.');
  const keys = candidates.map(p => identifier(parentPattern.exec(p.parentInstance)[2]));
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw new Error('Ambiguous USB parent identity. ' + explicit);
  let devices;
  try { devices = await attached(candidates); }
  catch { throw new Error('Windows and Apple USB device records could not be matched. ' + explicit); }
  const phones = [];
  for (const [index, parent] of candidates.entries()) {
    const [_, pid] = parentPattern.exec(parent.parentInstance);
    const linked = devices.filter(m => m.Properties?.ConnectionType === 'USB' &&
      identifier(m.Properties.SerialNumber) === keys[index] && Number.isSafeInteger(m.DeviceID) && m.DeviceID > 0 &&
      (m.Properties.ProductID == null || Number(m.Properties.ProductID) === parseInt(pid,16)));
    if (linked.length !== 1) throw new Error('Ambiguous USB device association. ' + explicit);
    const device = linked[0], bus = family(parent.product);
    let model = family(device.Properties.ProductType);
    if (!bus && !model) {
      try { model = family(await productType(device.DeviceID)); } catch { /* Ask for an explicit selection below. */ }
    }
    if ((!bus && !model) || (bus && model && bus !== model)) throw new Error('Cannot confirm the connected Apple device family. ' + explicit);
    if ((bus || model) === 'iphone') {
      const name=String(device.Properties.DeviceName||parent.product||'iPhone').replace(/[\x00-\x1f]/g,'').trim().slice(0,80)||'iPhone';
      const key=createHash('sha256').update(keys[index]).digest('hex');
      phones.push({parentInstance:parent.parentInstance,DeviceID:device.DeviceID,key,name,suffix:keys[index].slice(-5),
        Properties:{ConnectionType:'USB',SerialNumber:device.Properties.SerialNumber}});
    }
  }
  if (!phones.length) throw new Error('No USB iPhone found.');
  return phones;
}

function chooseUsbIphone(phones,targetKey,lastKey) {
  const match=phones.find(phone=>phone.key===(targetKey||lastKey));
  if(match)return match;
  if(targetKey)throw Object.assign(Error('Selected USB iPhone is absent.'),{code:'USB_IPHONE_NOT_FOUND'});
  if(phones.length!==1)throw Object.assign(Error('Multiple USB iPhones are connected. '+explicit),{code:'USB_MULTIPLE_IPHONES'});
  return phones[0];
}
async function selectUsbIphone(options={}) {
  return chooseUsbIphone(await listUsbIphones(options),options.targetKey,options.lastKey);
}
module.exports = { selectUsbIphone, listUsbIphones, chooseUsbIphone, parentPattern, listAppleParents };
