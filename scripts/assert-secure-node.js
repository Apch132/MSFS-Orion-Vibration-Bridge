'use strict'
const [major, minor, patch] = process.versions.node.split('.').map(Number)
if (major !== 22 || minor < 23 || (minor === 23 && patch < 4)) {
  console.error('[security] Node.js 22.23.4 or newer in the Node 22 series is required; found ' + process.version)
  process.exit(1)
}
