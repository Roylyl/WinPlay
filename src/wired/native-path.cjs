'use strict';

const path = require('node:path');

function nativePath(name) {
  if (process.env.WINPLAY_NATIVE) return path.join(path.dirname(process.env.WINPLAY_NATIVE), name);
  if (process.resourcesPath && /(?:^|[\\/])app\.asar(?:\.unpacked)?[\\/]/i.test(__dirname)) {
    return path.join(process.resourcesPath, 'native', name);
  }
  return path.resolve(__dirname, '../../build/native', name);
}

module.exports = { nativePath };
