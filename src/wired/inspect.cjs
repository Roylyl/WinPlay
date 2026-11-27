'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { analyzeConfigurations } = require('./configurations.cjs');
const { nativePath } = require('./native-path.cjs');

const maxSnapshotBytes = 255 * 65535 * 2 + 8192;

function analyzeSnapshot(snapshot, options) {
  if (!snapshot || !Array.isArray(snapshot.configurations) ||
      snapshot.configurations.length < 1 || snapshot.configurations.length > 255) {
    throw new Error('Expected a snapshot containing 1 to 255 configuration descriptors.');
  }
  const descriptors = snapshot.configurations.map(hex => {
    if (typeof hex !== 'string' || hex.length < 18 || hex.length > 131070 ||
        hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
      throw new Error('Invalid hexadecimal USB configuration descriptor.');
    }
    return Buffer.from(hex, 'hex');
  });
  return analyzeConfigurations(snapshot.activeValue, descriptors, options);
}

function inspectParent(parentInstance, options) {
  const result = spawnSync(nativePath('UsbReadConfigurations.exe'), ['--parent-instance', parentInstance], {
    windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: maxSnapshotBytes
  });
  if (result.error) {
    const code = result.error.code;
    throw new Error(code === 'ENOENT' ? 'WinPlay USB descriptor reader is missing.' :
      'USB descriptor reader did not finish (' + code + ').');
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'USB descriptor read failed.');
  }
  return analyzeSnapshot(JSON.parse(result.stdout), options);
}

const usage = [
  'node inspect.cjs --snapshot <snapshot.json> [--after-transition]',
  'node inspect.cjs --parent-instance <Apple USB parent instance> [--after-transition]',
  'The default inspection is read-only. --after-transition only describes a previously attempted mode change.',
  'ready describes endpoints in the active configuration. Media reception requires a separate live test.'
].join('\n');

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--help')) {
    console.log(usage);
  } else if (!['--snapshot', '--parent-instance'].includes(args[0]) || !args[1] ||
      args.length > 3 || (args.length === 3 && args[2] !== '--after-transition')) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    try {
      const options = { transitionAttempted: args[2] === '--after-transition' };
      let report;
      if (args[0] === '--snapshot') {
        const stat = fs.statSync(args[1]);
        if (!stat.isFile() || stat.size > maxSnapshotBytes) throw new Error('Invalid snapshot file.');
        report = analyzeSnapshot(JSON.parse(fs.readFileSync(args[1], 'utf8')), options);
      } else {
        report = inspectParent(args[1], options);
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error.code || error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { analyzeSnapshot, inspectParent };
