'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const REAL_HOST = path.join(__dirname, '..', 'lib', 'bridge', 'host.js')
const FAKE_HOST = path.join(__dirname, 'fixtures', 'fake-bridge-host.js')

function spawnScript(script, extraArgs = []) {
  const child = spawn(process.execPath, [script, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = []
  let waiters = []

  rl.on('line', (line) => {
    const trimmed = String(line || '').trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch (err) {
      waiters.splice(0).forEach((w) => w.reject(err))
      return
    }
    if (waiters.length) waiters.shift().resolve(msg)
    else pending.push(msg)
  })

  async function nextEvent(timeoutMs = 5000) {
    if (pending.length) return pending.shift()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w.resolve !== resolve)
        reject(new Error('timeout waiting for host event'))
      }, timeoutMs)
      waiters.push({
        resolve(msg) {
          clearTimeout(timer)
          resolve(msg)
        },
        reject(err) {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  function send(cmd) {
    child.stdin.write(`${JSON.stringify(cmd)}\n`)
  }

  async function shutdown() {
    try {
      send({ cmd: 'shutdown' })
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      child.once('exit', resolve)
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve()
      }, 3000)
    })
    rl.close()
  }

  return { child, nextEvent, send, shutdown }
}

describe('bridge host protocol (fake sidecar)', () => {
  it('emits ready with protocolVersion 1', async () => {
    const host = spawnScript(FAKE_HOST)
    const ready = await host.nextEvent()
    assert.equal(ready.protocolVersion, 1)
    assert.equal(ready.event, 'ready')
    assert.equal(ready.type, 'ready')
    await host.shutdown()
  })

  it('rejects invalid json without dying', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.child.stdin.write('{{not-json\n')
    const err = await host.nextEvent()
    assert.equal(err.event, 'error')
    assert.match(err.message, /invalid json/)
    host.send({ cmd: 'ping' })
    assert.equal((await host.nextEvent()).event, 'pong')
    await host.shutdown()
  })

  it('reports unknown commands', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.send({ cmd: 'fly' })
    const err = await host.nextEvent()
    assert.equal(err.event, 'error')
    assert.match(err.message, /unknown cmd/)
    await host.shutdown()
  })

  it('start/stop are idempotent at protocol level', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.send({ cmd: 'start' })
    assert.equal((await host.nextEvent()).event, 'started')
    host.send({ cmd: 'start' })
    assert.equal((await host.nextEvent()).event, 'started')
    host.send({ cmd: 'stop' })
    assert.equal((await host.nextEvent()).event, 'stopped')
    host.send({ cmd: 'stop' })
    assert.equal((await host.nextEvent()).event, 'stopped')
    await host.shutdown()
  })

  it('updatePreferences is forwarded', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.send({
      cmd: 'updatePreferences',
      preferences: { appearance: { theme: 'cockpit' } },
    })
    const updated = await host.nextEvent()
    assert.equal(updated.event, 'preferencesUpdated')
    assert.equal(updated.preferences.appearance.theme, 'cockpit')
    await host.shutdown()
  })

  it('shutdownComplete ends the process', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.send({ cmd: 'shutdown' })
    assert.equal((await host.nextEvent()).event, 'shutdownComplete')
    const code = await new Promise((resolve) => host.child.once('exit', resolve))
    assert.equal(code, 0)
  })

  it('crash-after-ready exits non-zero', async () => {
    const host = spawnScript(FAKE_HOST, ['--crash-after-ready'])
    assert.equal((await host.nextEvent()).event, 'ready')
    const code = await new Promise((resolve) => host.child.once('exit', resolve))
    assert.notEqual(code, 0)
  })

  it('hang-before-ready can be killed (startup timeout fallback)', async () => {
    const host = spawnScript(FAKE_HOST, ['--hang-before-ready'])
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(host.child.exitCode, null)
    const exited = new Promise((resolve) => host.child.once('exit', resolve))
    host.child.kill()
    await exited
    assert.equal(host.child.killed, true)
  })

  it('getTelemetry on fake host', async () => {
    const host = spawnScript(FAKE_HOST)
    await host.nextEvent()
    host.send({ cmd: 'getTelemetry' })
    const msg = await host.nextEvent()
    assert.equal(msg.event, 'telemetry')
    assert.equal(msg.payload.schemaVersion, 1)
    assert.ok(msg.payload.flight)
    await host.shutdown()
  })
})

describe('real bridge host smoke', () => {
  it('ready + ping + shutdown without Node PATH tricks', async () => {
    const host = spawnScript(REAL_HOST)
    const ready = await host.nextEvent(10000)
    assert.equal(ready.protocolVersion, 1)
    assert.equal(ready.event, 'ready')
    host.send({ cmd: 'ping' })
    assert.equal((await host.nextEvent()).event, 'pong')
    host.send({ cmd: 'shutdown' })
    assert.equal((await host.nextEvent()).event, 'shutdownComplete')
  })
})

describe('CLI non-regression smoke', () => {
  it('package main still points at vibration.js CLI entry', () => {
    const pkg = require('../package.json')
    assert.equal(pkg.main, 'vibration.js')
    assert.equal(pkg.bin, 'vibration.js')
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'vibration.js')))
    const src = fs.readFileSync(path.join(__dirname, '..', 'vibration.js'), 'utf8')
    assert.match(src, /createBridge/)
    assert.match(src, /lib\/bridge/)
  })

  it('Tauri bridge_host does not spawn node at runtime', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'apps', 'launcher', 'src-tauri', 'src', 'bridge_host.rs'),
      'utf8',
    )
    const production = src.split('#[cfg(test)]')[0]
    assert.doesNotMatch(production, /Command::new\("node"\)/)
    assert.doesNotMatch(production, /node\.exe/)
    assert.doesNotMatch(production, /"where"/)
    assert.match(production, /bridge-host/)
  })
})
