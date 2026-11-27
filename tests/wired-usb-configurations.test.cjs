'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeConfigurations } = require('../src/wired/configurations.cjs');

function config(value, descriptors) {
  const count = new Set(descriptors.filter(d => d[1] === 4).map(d => d[2])).size;
  const bytes = Buffer.from([9, 2, 0, 0, count, value, 0, 0x80, 50, ...descriptors.flat()]);
  bytes.writeUInt16LE(bytes.length, 2);
  return bytes;
}
const iface = (number, alt, cls, sub, protocol, endpoints = 0) => [9, 4, number, alt, endpoints, cls, sub, protocol, 0];
const endpoint = (address, type = 2) => [7, 5, address, type, 64, 0, 0];
const mux = (number = 1) => [iface(number, 0, 0xff, 0xfe, 2, 2), endpoint(0x85), endpoint(4)];
const ethernet = number => iface(number, 0, 0xff, 0xfd, 1);
const ncm = number => iface(number, 0, 2, 0x0d, 0);
const data = (number, alt = 1, input = 0x82, output = 3) => [
  iface(number, 0, 0x0a, 0, 1), iface(number, alt, 0x0a, 0, 1, 2), endpoint(input), endpoint(output),
];
const union = (master, slave) => [5, 0x24, 6, master, slave];
const iad = (start, count) => [8, 0x0b, start, count, 2, 0x0d, 0, 0];
const ptp = () => iface(0, 0, 6, 1, 1);
const preferred = value => config(value, [ptp(), ...mux(), ethernet(2), ncm(3), union(3, 4), ...data(4)]);
const compatibility = value => config(value, [...mux(), ncm(5), ...data(6, 2)]);

test('ordinary USB configurations require the mode transition; after a failed transition there is no media candidate', () => {
  const descriptors = [
    config(1, [ptp()]), config(2, [iface(0, 0, 1, 1, 0), iface(1, 0, 1, 2, 0), iface(2, 0, 3, 0, 0)]),
    config(3, [ptp(), ...mux()]), config(4, [ptp(), ...mux(), ethernet(2)]),
  ];
  const result = analyzeConfigurations(3, descriptors);
  assert.equal(result.action, 'request-mode-transition');
  assert.equal(result.activeCandidate, undefined);
  assert.equal(result.activeUsbMuxInterface, 1);
  assert.deepEqual(result.configurations[3], { value: 4, configurationIndex: 3, usbMux: true, usbMuxInterface: 1,
    ncmControl: false, appleEthernet: true, mediaEndpoints: false });
  assert.equal(analyzeConfigurations(3, descriptors, { transitionAttempted: true }).action, 'no-media-configuration');
});

test('prefer a CarPlay configuration over an active compatibility configuration and return endpoint addresses', () => {
  const descriptors = [compatibility(5), preferred(9)];
  const result = analyzeConfigurations(5, descriptors, { transitionAttempted: true });
  assert.equal(result.action, 'select-configuration');
  assert.equal(result.activeCandidate.value, 5);
  assert.equal(result.activeCandidate.configurationIndex, 0);
  assert.equal(result.activeCandidate.controlInterface, 5);
  assert.equal(result.activeCandidate.dataInterface, 6);
  assert.equal(result.activeCandidate.appleEthernet, false);
  assert.deepEqual(result.selected, {
    value: 9, configurationIndex: 1, controlInterface: 3, controlAlt: 0, dataInterface: 4, dataAlt: 1, bulkIn: 0x82, bulkOut: 3,
    usbMuxInterface: 1, usbMuxAlt: 0, usbMuxBulkIn: 0x85, usbMuxBulkOut: 4, appleEthernet: true,
  });
  assert.equal(analyzeConfigurations(9, descriptors).action, 'ready');
});

test('Identification uses only a uniquely usable USBMUX interface in the active configuration', () => {
  const ordinary = config(3, [...mux(0)]);
  const target = preferred(12);
  const report = analyzeConfigurations(3, [ordinary, target]);
  assert.equal(report.activeUsbMuxInterface, 0);
  assert.equal(report.selected.usbMuxInterface, 1);
  assert.deepEqual(report.configurations.map(item => item.configurationIndex), [0, 1]);
  assert.equal(analyzeConfigurations(0, [ordinary, target]).activeUsbMuxInterface, undefined);
  assert.equal(analyzeConfigurations(0, [ordinary, target]).activeCandidate, undefined);
  const ambiguous = config(4, [...mux(0), ...mux(1), ethernet(2), ncm(3), ...data(4)]);
  const ambiguousReport = analyzeConfigurations(4, [ambiguous]);
  assert.equal(ambiguousReport.activeUsbMuxInterface, undefined);
  assert.equal(ambiguousReport.selected, undefined);
  const incomplete = config(8, [iface(0, 0, 0xff, 0xfe, 2, 1), endpoint(4)]);
  assert.equal(analyzeConfigurations(8, [incomplete]).activeUsbMuxInterface, undefined);
});

test('an active USBMUX+NCM compatibility configuration gets one transition before reuse', () => {
  const descriptors = [compatibility(8)];
  assert.equal(analyzeConfigurations(8, descriptors).action, 'request-mode-transition');
  const result = analyzeConfigurations(8, descriptors, { transitionAttempted: true });
  assert.equal(result.action, 'ready');
  assert.equal(result.selected.dataAlt, 2);
  assert.equal(result.selected.appleEthernet, false);
});

test('only the Union slave may carry data for this NCM control interface', () => {
  const result = analyzeConfigurations(7, [config(7, [
    ...mux(), ethernet(2), ncm(3), union(3, 7), ...data(4), ...data(7, 1, 0x83, 6),
  ])]);
  assert.equal(result.selected.dataInterface, 7);
  assert.equal(result.selected.bulkOut, 6);
});

test('IAD groups isolate multiple CDC functions even when data descriptors are listed in a different order', () => {
  const result = analyzeConfigurations(7, [config(7, [
    ...mux(), ethernet(2), iad(5, 2), iface(5, 0, 2, 2, 1), ...data(6), iad(3, 2), ncm(3), ...data(4),
  ])]);
  assert.equal(result.selected.dataInterface, 4);
});

test('cross-group Union, ambiguous unassociated interfaces, or a slave claimed by another control cannot be paired', () => {
  for (const declarations of [
    [iad(3, 2), ncm(3), union(3, 6), ...data(4), iad(5, 2), iface(5, 0, 2, 2, 1), ...data(6)],
    [ncm(3), ...data(4), ...data(6)],
    [ncm(3), iface(5, 0, 2, 2, 1), ...data(4)],
    [ncm(3), iface(5, 0, 2, 2, 1), union(5, 4), ...data(4)],
  ]) {
    const result = analyzeConfigurations(7, [config(7, [...mux(), ethernet(2), ...declarations])], { transitionAttempted: true });
    assert.equal(result.action, 'no-media-configuration');
    assert.equal(result.selected, undefined);
  }
});

test('both bulk directions must exist on the same alternate and on USBMUX', () => {
  const badData = [iface(4, 0, 0x0a, 0, 1, 1), endpoint(0x82), iface(4, 1, 0x0a, 0, 1, 1), endpoint(3)];
  const badMux = [iface(1, 0, 0xff, 0xfe, 2, 2), endpoint(0x85, 3), endpoint(4)];
  assert.equal(analyzeConfigurations(9, [config(9, [...mux(), ethernet(2), ncm(3), ...badData])]).action, 'request-mode-transition');
  assert.equal(analyzeConfigurations(9, [config(9, [...badMux, ethernet(2), ncm(3), ...data(4)])]).action, 'request-mode-transition');
});

test('reject incomplete descriptors, inconsistent counts, duplicate configuration values, and invalid arguments', () => {
  const good = preferred(11);
  const partial = good.subarray(0, good.length - 2);
  const trailing = Buffer.from(partial); trailing.writeUInt16LE(trailing.length, 2);
  const missingEndpoint = Buffer.from(good.subarray(0, -7)); missingEndpoint.writeUInt16LE(missingEndpoint.length, 2);
  const wrongCount = Buffer.from(good); wrongCount[4]++;
  const zeroLength = Buffer.from(good); zeroLength[9] = 0;
  for (const bad of [partial, trailing, missingEndpoint, wrongCount, zeroLength]) {
    assert.throws(() => analyzeConfigurations(11, [bad]), RangeError);
  }
  assert.throws(() => analyzeConfigurations(11, [good, good]), /Duplicate/);
  assert.throws(() => analyzeConfigurations(4, [good]), /missing from the snapshot/);
  assert.equal(analyzeConfigurations(0, [good]).action, 'select-configuration');
  assert.throws(() => analyzeConfigurations(-1, [good]), RangeError);
  assert.throws(() => analyzeConfigurations(11, [good], { transitionAttempted: 'no' }), TypeError);
  assert.equal(analyzeConfigurations(11, [new Uint8Array(good)]).action, 'ready');
});
