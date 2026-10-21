'use strict'
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const file = process.argv[2]
if (!file || !fs.existsSync(file)) {
  console.error('[security] Built executable not found: ' + file)
  process.exit(1)
}
const result = spawnSync(file, ['--runtime-version'], {encoding:'utf8', timeout:15000, windowsHide:true})
const version = (result.stdout || '').trim()
const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version)
if(result.error || result.status !== 0 || !match) {
  console.error('[security] Cannot verify embedded Node.js version:', result.error?.message || result.stderr || version)
  process.exit(1)
}
const [major,minor,patch] = match.slice(1).map(Number)
if(major !== 22 || minor < 23 || (minor === 23 && patch < 4)) {
  console.error('[security] Executable contains vulnerable or unsupported Node.js: ' + version)
  process.exit(1)
}
console.log('[security] Verified embedded Node.js ' + version + ' in ' + file)
