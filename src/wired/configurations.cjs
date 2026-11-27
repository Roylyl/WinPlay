'use strict';

function parseConfiguration(raw, index) {
  const invalid = reason => new RangeError('USB configuration ' + index + ': ' + reason);
  if (!(raw instanceof Uint8Array)) throw new TypeError('Expected a USB configuration byte buffer');
  if (raw.length < 9 || raw.length > 65535) throw invalid('invalid buffer length');
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes[1] !== 2 || bytes[0] < 9 || bytes[0] > bytes.length) throw invalid('invalid configuration header');
  if (bytes.readUInt16LE(2) !== bytes.length) throw invalid('buffer length does not match wTotalLength');
  const value = bytes[5];
  if (!value) throw invalid('zero bConfigurationValue');

  const interfaces = [], byNumber = new Map(), groups = new Map(), unions = new Map();
  let current;
  for (let offset = bytes[0]; offset < bytes.length;) {
    const length = bytes[offset], type = bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalid('truncated or invalid descriptor at ' + offset);
    const d = bytes.subarray(offset, offset + length);
    offset += length;
    if (type === 2) throw invalid('unexpected second configuration header');
    if (type === 4) {
      if (length < 9) throw invalid('short interface descriptor');
      current = { number: d[2], alt: d[3], endpointCount: d[4], cls: d[5], sub: d[6], protocol: d[7], endpoints: [] };
      const alternates = byNumber.get(current.number) || new Set();
      if (alternates.has(current.alt)) throw invalid('duplicate interface alternate setting');
      alternates.add(current.alt);
      byNumber.set(current.number, alternates);
      interfaces.push(current);
    } else if (type === 5) {
      if (length < 7 || !current) throw invalid('invalid endpoint descriptor');
      if (!(d[2] & 15) || (d[2] & 0x70)) throw invalid('invalid endpoint address');
      if (current.endpoints.some(ep => ep.address === d[2])) throw invalid('duplicate endpoint address');
      current.endpoints.push({ address: d[2], transfer: d[3] & 3 });
    } else if (type === 0x0b) {
      if (length < 8 || !d[3] || d[2] + d[3] > 256) throw invalid('invalid interface association');
      for (let id = d[2]; id < d[2] + d[3]; id++) {
        if (groups.has(id)) throw invalid('overlapping interface associations');
        groups.set(id, d[2]);
      }
      current = undefined;
    } else if (type === 0x24 && current?.cls === 2) {
      if (length < 3) throw invalid('short CDC functional descriptor');
      if (d[2] !== 6) continue;
      if (length < 5 || d[3] !== current.number) throw invalid('invalid CDC Union descriptor');
      const next = unions.get(current.number) || new Set();
      for (const slave of d.subarray(4)) next.add(slave);
      unions.set(current.number, next);
    }
  }
  if (byNumber.size !== bytes[4]) throw invalid('interface count does not match bNumInterfaces');
  if (interfaces.some(iface => iface.endpoints.length !== iface.endpointCount)) throw invalid('endpoint count does not match bNumEndpoints');
  return { value, configurationIndex: index, interfaces, groups, unions };
}

function bulkPair(iface, preferMuxEndpoints = false) {
  const bulk = iface.endpoints.filter(ep => ep.transfer === 2).map(ep => ep.address);
  function pick(incoming, preferred) {
    const matches = bulk.filter(address => Boolean(address & 0x80) === incoming);
    if (preferMuxEndpoints && matches.includes(preferred)) return preferred;
    return matches.length === 1 ? matches[0] : undefined;
  }
  const input = pick(true, 0x85), output = pick(false, 0x04);
  return input && output ? { input, output } : undefined;
}

function matchNcm(config, control) {
  const { interfaces, groups, unions } = config;
  const masters = new Set(interfaces.filter(iface => iface.cls === 2).map(iface => iface.number));
  const data = interfaces.filter(iface => iface.cls === 0x0a);
  const group = groups.get(control.number);
  const slaves = unions.get(control.number);
  const claimedElsewhere = new Set();
  for (const [master, ids] of unions) {
    if (master !== control.number) for (const id of ids) claimedElsewhere.add(id);
  }

  // A Union names a specific control/data relationship. Without one, a
  // group with multiple unassigned masters does not uniquely identify a pair.
  if (!slaves) {
    const unassigned = [...masters].filter(id => groups.get(id) === group && !unions.has(id));
    if (unassigned.length !== 1) return undefined;
  }
  const candidates = data.filter(iface =>
    groups.get(iface.number) === group && !claimedElsewhere.has(iface.number) &&
    (!slaves || slaves.has(iface.number)));
  if (new Set(candidates.map(iface => iface.number)).size !== 1) return undefined;
  const usable = candidates.map(iface => ({ iface, pair: bulkPair(iface) })).filter(entry => entry.pair);
  // Prefer the CDC-NCM data alternate setting convention, otherwise use a
  // descriptor-advertised alternate that actually has both bulk endpoints.
  const selected = usable.find(entry => entry.iface.alt === 1) || usable[0];
  if (!selected) return undefined;
  return { controlInterface: control.number, controlAlt: control.alt, dataInterface: selected.iface.number,
    dataAlt: selected.iface.alt, bulkIn: selected.pair.input, bulkOut: selected.pair.output };
}

function inspect(config) {
  const { interfaces, value, configurationIndex } = config;
  const matches = (iface, cls, sub, protocol) => iface.cls === cls && iface.sub === sub && iface.protocol === protocol;
  const muxInterfaces = interfaces.filter(iface => matches(iface, 0xff, 0xfe, 2));
  // Identification names an interface, not a pipe. Two distinct USBMUX
  // interfaces cannot be disambiguated from descriptors alone.
  let mux;
  if (new Set(muxInterfaces.map(iface => iface.number)).size === 1) {
    const usable = muxInterfaces.map(iface => ({ iface, pair: bulkPair(iface, true) })).filter(entry => entry.pair);
    mux = usable.find(entry => entry.iface.alt === 0) || usable[0];
  }
  const appleEthernet = interfaces.some(iface => matches(iface, 0xff, 0xfd, 1));
  const controls = interfaces.filter(iface => iface.cls === 2 && iface.sub === 0x0d);
  let ncm;
  for (const control of controls) {
    ncm = matchNcm(config, control);
    if (ncm) break;
  }
  const summary = { value, configurationIndex, usbMux: muxInterfaces.length > 0, usbMuxInterface: mux?.iface.number,
    ncmControl: controls.length > 0, appleEthernet,
    mediaEndpoints: Boolean(ncm && mux) };
  if (!mux || !ncm) return { summary };
  const selected = { value, configurationIndex, ...ncm, usbMuxInterface: mux.iface.number, usbMuxAlt: mux.iface.alt,
    usbMuxBulkIn: mux.pair.input, usbMuxBulkOut: mux.pair.output, appleEthernet };
  return { summary, selected };
}

// "ready" means the active configuration describes appropriate USB endpoints.
// Opening them, establishing a CarPlay session and receiving media are later steps.
function analyzeConfigurations(activeValue, rawBuffers, { transitionAttempted = false } = {}) {
  if (!Number.isInteger(activeValue) || activeValue < 0 || activeValue > 255) throw new RangeError('Invalid active USB configuration');
  if (!Array.isArray(rawBuffers) || !rawBuffers.length || rawBuffers.length > 255) throw new RangeError('Expected 1 to 255 USB configurations');
  if (typeof transitionAttempted !== 'boolean') throw new TypeError('Expected a boolean transitionAttempted');
  const parsed = Array.from(rawBuffers, (raw, index) => inspect(parseConfiguration(raw, index)));
  const configurations = parsed.map(entry => entry.summary);
  if (new Set(configurations.map(item => item.value)).size !== configurations.length) throw new RangeError('Duplicate bConfigurationValue');
  const active = parsed.find(item => item.summary.value === activeValue);
  if (activeValue !== 0 && !active) throw new RangeError('Active configuration is missing from the snapshot');
  // The preferred configuration and the one already driving a native UsbNcm adapter can differ.
  // Only the caller can verify that Windows has bound that adapter to this phone.
  const report = { activeValue, activeUsbMuxInterface: active?.summary.usbMuxInterface,
    activeCandidate: active?.selected, configurations };
  const candidates = parsed.map(entry => entry.selected).filter(Boolean);
  const preferred = candidates.filter(item => item.appleEthernet);
  const eligible = preferred.length ? preferred : transitionAttempted ? candidates : [];
  const selected = eligible.find(item => item.value === activeValue) || eligible[0];
  if (!selected) return { action: transitionAttempted ? 'no-media-configuration' : 'request-mode-transition', ...report };
  return { action: selected.value === activeValue ? 'ready' : 'select-configuration', ...report, selected };
}

module.exports = { analyzeConfigurations };
