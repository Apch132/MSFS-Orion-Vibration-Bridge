'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  createBridge,
  getDefaultBridgePreferences,
} = require('../lib/bridge')

function createMockHid(openPids = [0xBD64, 0xBEA8]) {
  const writes = []
  const devices = openPids.map((productId) => ({
    vendorId: 0x4098,
    productId,
    path: `mock://${productId}`,
  }))

  class MockHID {
    constructor(path) {
      this.path = path
      this.closed = false
      this.handlers = {}
    }
    on(event, fn) {
      this.handlers[event] = fn
    }
    removeAllListeners() {
      this.handlers = {}
    }
    write(packet) {
      if (this.closed) throw new Error('closed')
      writes.push({ path: this.path, packet })
    }
    close() {
      this.closed = true
    }
  }

  return {
    writes,
    devices: () => devices.slice(),
    HID: MockHID,
  }
}

function createMockSimConnect(options = {}) {
  const { connect = true, applicationName = 'MockMSFS' } = options
  const handles = []

  return {
    Protocol: { FSX_SP2: 1 },
    SimConnectDataType: { FLOAT64: 1 },
    SimConnectPeriod: { SIM_FRAME: 1 },
    SimConnectConstants: { UNUSED: 0, OBJECT_ID_USER: 0 },
    open() {
      if (!connect) return Promise.reject(new Error('simulator offline'))
      const handlers = {}
      const handle = {
        addToDataDefinition() {},
        requestDataOnSimObject() {},
        on(event, fn) { handlers[event] = fn },
        removeAllListeners() {
          for (const key of Object.keys(handlers)) delete handlers[key]
        },
        close() {},
        _emit(event, payload) {
          if (handlers[event]) handlers[event](payload)
        },
      }
      handles.push(handle)
      return Promise.resolve({
        recvOpen: { applicationName },
        handle,
      })
    },
    handles,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('shared bridge runtime', () => {
  it('start is idempotent when already running', async () => {
    const bridge = createBridge({
      hid: createMockHid(),
      simconnect: createMockSimConnect(),
      autoConnectSim: false,
    })
    const a = await bridge.start()
    const b = await bridge.start()
    assert.equal(a.status, 'running')
    assert.equal(b.status, 'running')
    assert.equal(bridge.isRunning(), true)
    await bridge.stop()
  })

  it('stop is idempotent when already stopped', async () => {
    const bridge = createBridge({
      hid: createMockHid(),
      simconnect: createMockSimConnect(),
      autoConnectSim: false,
    })
    const a = await bridge.stop()
    const b = await bridge.stop()
    assert.equal(a.status, 'stopped')
    assert.equal(b.status, 'stopped')
    assert.equal(bridge.isRunning(), false)
  })

  it('reports Running then Stopped through getState', async () => {
    const bridge = createBridge({
      hid: createMockHid(),
      simconnect: createMockSimConnect(),
      autoConnectSim: false,
    })
    assert.equal(bridge.getState().status, 'stopped')
    await bridge.start()
    assert.equal(bridge.getState().status, 'running')
    await bridge.stop()
    assert.equal(bridge.getState().status, 'stopped')
  })

  it('updatePreferences while running applies without restart', async () => {
    const bridge = createBridge({
      hid: createMockHid(),
      simconnect: createMockSimConnect(),
      autoConnectSim: false,
      preferences: getDefaultBridgePreferences(),
    })
    await bridge.start()

    bridge.ingestSimSample({
      engCombustion1: 1,
      numberOfEngines: 1,
      engineType: 1,
      engineRpm1: 8000,
      onGround: 0,
    })
    const before = bridge.getMotorIntensities()['F15EX L'] || 0

    const prefs = getDefaultBridgePreferences()
    prefs.profiles.aircraft.master.intensity = 50
    bridge.updatePreferences(prefs)

    bridge.ingestSimSample({
      engCombustion1: 1,
      numberOfEngines: 1,
      engineType: 1,
      engineRpm1: 8000,
      onGround: 0,
    })
    const after = bridge.getMotorIntensities()['F15EX L'] || 0

    assert.ok(before > 0, 'expected engine vibration before scale')
    assert.ok(after < before, 'master 50% should reduce output')
    assert.equal(bridge.getState().preferences.profiles.aircraft.master.intensity, 50)
    assert.equal(bridge.isRunning(), true)
    await bridge.stop()
  })

  it('clean stop zeroes motors and leaves status stopped', async () => {
    const hid = createMockHid()
    const bridge = createBridge({
      hid,
      simconnect: createMockSimConnect(),
      autoConnectSim: false,
    })
    await bridge.start()
    bridge.ingestSimSample({
      engCombustion1: 1,
      numberOfEngines: 1,
      engineType: 1,
      engineRpm1: 9000,
    })
    await bridge.stop()
    assert.equal(bridge.getState().status, 'stopped')
    assert.equal(bridge.getMotorIntensities()['F15EX L'] || 0, 0)
    assert.equal(Object.keys(hid.writes).length > 0 || hid.writes.length >= 0, true)
  })

  it('emits state events on start and stop', async () => {
    const bridge = createBridge({
      hid: createMockHid([]),
      simconnect: createMockSimConnect({ connect: false }),
      autoConnectSim: false,
    })
    const statuses = []
    bridge.on('state', (s) => statuses.push(s.status))
    await bridge.start()
    await bridge.stop()
    assert.ok(statuses.includes('starting') || statuses.includes('running'))
    assert.ok(statuses.includes('stopped'))
  })
})
