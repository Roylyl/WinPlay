'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareUsbParent } = require('../src/wired/prepare.cjs');

const parent = 'USB\\VID_05AC&PID_1901\\SIMULATED';
const ordinary = { activeValue: 3, activeUsbMuxInterface: 0, configurations: [{ mediaEndpoints: false }] };

test('USB preparation reads by default and puts only the selected parent and actual mux in the native request', () => {
  const calls = [];
  function inspect(selected) { assert.equal(selected, parent); return ordinary; }
  function invoke(...args) { calls.push(args); return { action: 'fixture' }; }
  prepareUsbParent(parent, undefined, inspect, invoke);
  prepareUsbParent(parent, true, inspect, invoke);
  assert.deepEqual(calls, [[parent, 0, 1, false], [parent, 0, 1, true]]);
});

test('do not repeat a mode switch once a media configuration is exposed, even if it is not active', () => {
  const prepared = {...ordinary, configurations: [...ordinary.configurations, { mediaEndpoints: true }]};
  const result = prepareUsbParent(parent, true, () => prepared, () => assert.fail('mode switch attempted'));
  assert.equal(result.action, 'media-configuration-already-exposed');
  assert.equal(result.activeValue, ordinary.activeValue);
});

test('USB preparation rejects wildcard targets, other vendors and ambiguous active USBMUX', () => {
  for (const invalid of ['', 'USB\\VID_05AC&PID_1901\\*', 'USB\\VID_ABCD&PID_1901\\SIMULATED']) {
    assert.throws(() => prepareUsbParent(invalid, true, () => assert.fail('unexpected enumeration')), /complete Apple/);
  }
  assert.throws(() => prepareUsbParent(parent, true, () => ({...ordinary, activeUsbMuxInterface: undefined}),
    () => assert.fail('unexpected transfer')), /no unique USBMUX/);
});
