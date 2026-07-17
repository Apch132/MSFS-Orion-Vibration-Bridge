/**
 * Shared bridge runtime — unique orchestrator for SimConnect, HID, loops, reconnect.
 * Used by the CLI and by the launcher host process.
 */

'use strict'

const {
  safeNumber,
  buildVibPacket,
  intensityToHidByte,
  createTouchdownTracker,
} = require('../vibration-core')
const {
  getDefaultBridgePreferences,
  validateBridgePreferences,
} = require('./preferences')
const { computeMotorIntensities } = require('./compute')

const APP_VERSION = '0.1.0'
const WINWING_VID = 0x4098
const HID_ERROR_COOLDOWN_MS = 5000
const HID_REDISCOVER_MS = 3000
const SIM_RECONNECT_MS = 5000
const SEND_INTERVAL_MS = 20

const DEVICE_CONFIG = [
  {
    pid: 0xBD64,
    name: 'Throttle Base II',
    motors: [
      { subId: [0x01, 0xBF, 0x00, 0x00], motorIdx: 0, label: 'F15EX L', engineIdx: 0 },
      { subId: [0x02, 0xBF, 0x00, 0x00], motorIdx: 0, label: 'F15EX R', engineIdx: 1 },
    ],
  },
  {
    pid: 0xBEA8,
    name: 'Joystick Base 2',
    motors: [
      { subId: [0x07, 0xBE, 0x00, 0x00], motorIdx: 0, label: 'F16 JGRIP', engineIdx: null },
    ],
  },
]

const DEF_ID = 1
const REQ_ID = 1

const SIM_VARS = [
  ['GEAR TOTAL PCT EXTENDED', 'percent', 'gearPct'],
  ['AIRSPEED TRUE', 'knots', 'airspeedKnots'],
  ['AIRSPEED MACH', 'mach', 'mach'],
  ['G FORCE', 'GForce', 'gForce'],
  ['INCIDENCE ALPHA', 'degrees', 'aoa'],
  ['VERTICAL SPEED', 'feet per minute', 'vertSpeedFpm'],
  ['SIM ON GROUND', 'bool', 'onGround'],
  ['GEAR LEFT POSITION', 'percent', 'gearLeftPct'],
  ['GEAR RIGHT POSITION', 'percent', 'gearRightPct'],
  ['GEAR CENTER POSITION', 'percent', 'gearNosePct'],
  ['GENERAL ENG RPM:1', 'rpm', 'engineRpm1'],
  ['GENERAL ENG RPM:2', 'rpm', 'engineRpm2'],
  ['GENERAL ENG RPM:3', 'rpm', 'engineRpm3'],
  ['GENERAL ENG RPM:4', 'rpm', 'engineRpm4'],
  ['STALL WARNING', 'bool', 'stallWarning'],
  ['TURB ENG AFTERBURNER PCT ACTIVE:1', 'percent', 'afterburnerPct1'],
  ['TURB ENG AFTERBURNER PCT ACTIVE:2', 'percent', 'afterburnerPct2'],
  ['SPOILERS HANDLE POSITION', 'percent', 'speedbrakePct'],
  ['ENGINE TYPE', 'number', 'engineType'],
  ['ROTOR RPM PCT:1', 'percent', 'rotorRpmPct'],
  ['TRAILING EDGE FLAPS LEFT PERCENT', 'percent', 'flapsLeftPct'],
  ['NUMBER OF ENGINES', 'number', 'numberOfEngines'],
  ['GENERAL ENG COMBUSTION:1', 'bool', 'engCombustion1'],
  ['GENERAL ENG COMBUSTION:2', 'bool', 'engCombustion2'],
  ['GENERAL ENG COMBUSTION:3', 'bool', 'engCombustion3'],
  ['GENERAL ENG COMBUSTION:4', 'bool', 'engCombustion4'],
  ['APU PCT RPM', 'percent', 'apuPctRpm'],
]

function createInitialFlightState() {
  return {
    gearPct: 0, airspeedKnots: 0, mach: 0, gForce: 1.0, aoa: 0,
    vertSpeedFpm: 0, onGround: 1,
    gearLeftPct: 0, gearRightPct: 0, gearNosePct: 0,
    engineRpm1: 0, engineRpm2: 0, engineRpm3: 0, engineRpm4: 0,
    stallWarning: 0,
    afterburnerPct1: 0, afterburnerPct2: 0,
    speedbrakePct: 0,
    engineType: 1,
    rotorRpmPct: 0,
    flapsLeftPct: 0,
    numberOfEngines: 1,
    engCombustion1: 0, engCombustion2: 0, engCombustion3: 0, engCombustion4: 0,
    apuPctRpm: 0,
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.preferences]
 * @param {object} [options.hid] injectable HID module { devices(), HID }
 * @param {object} [options.simconnect] injectable { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants }
 * @param {() => number} [options.now]
 * @param {boolean} [options.autoConnectSim=true]
 * @param {(level: string, message: string) => void} [options.logger]
 */
function createBridge(options = {}) {
  const listeners = new Map()
  let preferences = validateBridgePreferences(
    options.preferences || getDefaultBridgePreferences(),
  )

  let status = 'stopped' // 'stopped' | 'starting' | 'running' | 'stopping'
  let simConnected = false
  let simApplicationName = null

  const openDevices = {}
  const motorIntensities = {}
  const hidErrorLogAt = {}
  const touchdown = createTouchdownTracker()
  const meta = { lastEngineType: -1, lastEnginesRunning: -1 }
  const state = createInitialFlightState()

  let sendInterval = null
  let rediscoverInterval = null
  let reconnectTimer = null
  let activeSimHandle = null
  let connectingSim = false
  let stopWaiters = []

  const now = options.now || (() => performance.now())
  const autoConnectSim = options.autoConnectSim !== false

  function log(level, message) {
    if (typeof options.logger === 'function') {
      options.logger(level, message)
      return
    }
    if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
    else console.log(message)
  }

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(handler)
    return () => listeners.get(event)?.delete(handler)
  }

  function emit(event, payload) {
    const set = listeners.get(event)
    if (!set) return
    for (const handler of set) {
      try { handler(payload) } catch (err) {
        log('error', `[bridge] listener error on ${event}: ${err && err.message ? err.message : err}`)
      }
    }
  }

  function getState() {
    return {
      status,
      running: status === 'running' || status === 'starting',
      simConnected,
      simApplicationName,
      hidOpenCount: Object.keys(openDevices).length,
      preferences: structuredClone(preferences),
      version: APP_VERSION,
    }
  }

  function emitState() {
    emit('state', getState())
  }

  function zeroAllMotors() {
    for (const cfg of DEVICE_CONFIG) {
      for (const motor of cfg.motors) motorIntensities[motor.label] = 0
    }
  }

  function logHidError(key, message) {
    const t = Date.now()
    if ((hidErrorLogAt[key] || 0) + HID_ERROR_COOLDOWN_MS > t) return
    hidErrorLogAt[key] = t
    log('error', `[HID] ${message}`)
  }

  function loadHid() {
    if (options.hid) return options.hid
    // eslint-disable-next-line import/no-extraneous-dependencies
    return require('node-hid')
  }

  function loadSimConnect() {
    if (options.simconnect) return options.simconnect
    return require('node-simconnect')
  }

  function dropDevice(pid, reason) {
    const dev = openDevices[pid]
    if (!dev) return
    try { dev.removeAllListeners?.('error') } catch (_) {}
    try { dev.close() } catch (_) {}
    delete openDevices[pid]
    logHidError(`drop-${pid}`, `Closed PID 0x${Number(pid).toString(16).toUpperCase()}: ${reason}`)
    emitState()
  }

  function tryOpenDevice(cfg) {
    if (openDevices[cfg.pid] || status === 'stopped' || status === 'stopping') {
      return Boolean(openDevices[cfg.pid])
    }
    const HID = loadHid()
    const all = HID.devices()
    const d = all.find(x => x.vendorId === WINWING_VID && x.productId === cfg.pid)
    if (!d) return false
    try {
      const dev = new HID.HID(d.path)
      if (typeof dev.on === 'function') {
        dev.on('error', (err) => {
          logHidError(`err-${cfg.pid}`, `${cfg.name}: ${err && err.message ? err.message : 'error'}`)
          dropDevice(cfg.pid, 'device error')
        })
      }
      openDevices[cfg.pid] = dev
      log('info', `[HID] Opened: ${cfg.name}  [${cfg.motors.map(m => m.label).join(', ')}]`)
      emitState()
      return true
    } catch (e) {
      logHidError(`open-${cfg.pid}`, `Could not open ${cfg.name}: ${e.message}`)
      return false
    }
  }

  function openOrRefreshHidDevices() {
    let opened = 0
    for (const cfg of DEVICE_CONFIG) {
      if (openDevices[cfg.pid] || tryOpenDevice(cfg)) opened++
    }
    return opened
  }

  function closeHidDevices() {
    for (const pid of Object.keys(openDevices)) {
      const n = Number(pid)
      const dev = openDevices[n]
      try {
        if (dev) {
          dev.removeAllListeners?.('error')
          dev.close()
        }
      } catch (_) {}
      delete openDevices[n]
    }
  }

  function sendVibration() {
    const HID = loadHid()
    void HID
    for (const cfg of DEVICE_CONFIG) {
      const dev = openDevices[cfg.pid]
      if (!dev) continue
      for (const motor of cfg.motors) {
        const value = intensityToHidByte(motorIntensities[motor.label])
        try {
          dev.write(buildVibPacket(motor.subId, motor.motorIdx, value))
        } catch (e) {
          logHidError(`write-${cfg.pid}`, `${cfg.name} write failed: ${e.message}`)
          dropDevice(cfg.pid, 'write failed')
          break
        }
      }
    }
  }

  function applyIntensities() {
    const next = computeMotorIntensities({
      state,
      preferences,
      touchdown,
      nowMs: now(),
      meta,
      deviceConfig: DEVICE_CONFIG,
      log: (msg) => log('info', msg),
    })
    for (const [label, value] of Object.entries(next)) {
      motorIntensities[label] = value
    }
  }

  function clearSimHandle() {
    if (!activeSimHandle) return
    try { activeSimHandle.removeAllListeners?.() } catch (_) {}
    try {
      if (typeof activeSimHandle.close === 'function') activeSimHandle.close()
    } catch (_) {}
    activeSimHandle = null
    simConnected = false
    simApplicationName = null
    emitState()
  }

  function cancelReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect(reason) {
    if (status !== 'running' && status !== 'starting') return
    zeroAllMotors()
    if (reconnectTimer) return
    if (reason) log('info', `[SIM] ${reason} — retrying in ${SIM_RECONNECT_MS / 1000}s`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectMSFS()
    }, SIM_RECONNECT_MS)
  }

  function connectMSFS() {
    if ((status !== 'running' && status !== 'starting') || connectingSim) return
    if (!autoConnectSim) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    connectingSim = true
    clearSimHandle()
    log('info', '[SIM] Connecting to MSFS2024...')

    const sc = loadSimConnect()
    sc.open('WinWing Vibration Bridge', sc.Protocol.FSX_SP2)
      .then(({ recvOpen, handle }) => {
        connectingSim = false
        if (status !== 'running' && status !== 'starting') {
          try { handle.close() } catch (_) {}
          return
        }
        activeSimHandle = handle
        simConnected = true
        simApplicationName = recvOpen?.applicationName || 'MSFS'
        log('info', `[SIM] Connected: ${simApplicationName}`)
        emitState()

        for (const [varName, unit] of SIM_VARS) {
          handle.addToDataDefinition(
            DEF_ID, varName, unit,
            sc.SimConnectDataType.FLOAT64, 0.0,
            sc.SimConnectConstants.UNUSED,
          )
        }

        handle.requestDataOnSimObject(
          REQ_ID, DEF_ID,
          sc.SimConnectConstants.OBJECT_ID_USER,
          sc.SimConnectPeriod.SIM_FRAME,
          0, 0, 0, 0,
        )

        handle.on('simObjectData', (recv) => {
          if (recv.requestID !== REQ_ID || status !== 'running') return
          for (const [, , key] of SIM_VARS) {
            state[key] = safeNumber(recv.data.readFloat64())
          }
          applyIntensities()
          emit('telemetry', { ...state })
        })

        handle.on('exception', (e) => {
          log('error', `[SIM] Exception: ${JSON.stringify(e)}`)
        })

        handle.on('quit', () => {
          log('info', '[SIM] MSFS quit — vibration stopped')
          clearSimHandle()
          scheduleReconnect('simulator quit')
        })

        handle.on('close', () => {
          clearSimHandle()
          scheduleReconnect('connection closed')
        })
      })
      .catch((err) => {
        connectingSim = false
        if (status !== 'running' && status !== 'starting') return
        log('warn', `[SIM] Not connected: ${err.message}`)
        scheduleReconnect('waiting for MSFS2024')
      })
  }

  function finishStop() {
    status = 'stopped'
    emitState()
    const waiters = stopWaiters
    stopWaiters = []
    for (const resolve of waiters) resolve(getState())
  }

  async function start() {
    if (status === 'running' || status === 'starting') {
      return getState()
    }
    if (status === 'stopping') {
      await new Promise((resolve) => { stopWaiters.push(resolve) })
    }

    status = 'starting'
    emitState()

    const opened = openOrRefreshHidDevices()
    if (opened === 0) {
      log('warn', '[HID] No compatible WinWing device found yet.')
      log('warn', '[HID] Waiting for hardware (will keep looking)...')
    }

    sendInterval = setInterval(() => {
      if (status === 'running' || status === 'starting') sendVibration()
    }, SEND_INTERVAL_MS)

    rediscoverInterval = setInterval(() => {
      if (status === 'running') openOrRefreshHidDevices()
    }, HID_REDISCOVER_MS)

    status = 'running'
    emitState()
    connectMSFS()
    return getState()
  }

  async function stop() {
    if (status === 'stopped') {
      return getState()
    }
    if (status === 'stopping') {
      return new Promise((resolve) => { stopWaiters.push(resolve) })
    }

    status = 'stopping'
    emitState()

    cancelReconnect()
    if (sendInterval) { clearInterval(sendInterval); sendInterval = null }
    if (rediscoverInterval) { clearInterval(rediscoverInterval); rediscoverInterval = null }

    zeroAllMotors()
    try { sendVibration() } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 300))

    closeHidDevices()
    clearSimHandle()
    connectingSim = false
    finishStop()
    return getState()
  }

  function updatePreferences(next) {
    preferences = validateBridgePreferences(next)
    if (status === 'running') {
      applyIntensities()
    }
    emit('preferences', structuredClone(preferences))
    emitState()
    return preferences
  }

  function isRunning() {
    return status === 'running' || status === 'starting'
  }

  /** Test helper: inject a flight-state sample and recompute (no SimConnect). */
  function ingestSimSample(sample) {
    if (!isRunning()) return
    for (const [key, value] of Object.entries(sample || {})) {
      if (key in state) state[key] = safeNumber(value, state[key])
    }
    applyIntensities()
    emit('telemetry', { ...state })
  }

  /** Test helper */
  function getMotorIntensities() {
    return { ...motorIntensities }
  }

  return {
    start,
    stop,
    updatePreferences,
    isRunning,
    getState,
    on,
    // internals exposed for tests / host diagnostics
    ingestSimSample,
    getMotorIntensities,
    DEVICE_CONFIG,
    APP_VERSION,
  }
}

module.exports = {
  createBridge,
  getDefaultBridgePreferences,
  validateBridgePreferences,
  DEVICE_CONFIG,
  APP_VERSION,
  SIM_VARS,
}
