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
const {
  buildTelemetrySnapshot,
  createFlightEventDetector,
  createTelemetryPublisher,
} = require('./telemetry')

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
const DEF_ID_STRING = 2
const REQ_ID_STRING = 2

/**
 * Float SimVars (definition 1). Each entry: [name, unit, stateKey]
 * Documented in docs/TELEMETRY.md.
 */
const SIM_VARS = [
  // Vibration core (existing)
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
  // Telemetry / HUD
  ['AIRSPEED INDICATED', 'knots', 'indicatedAirspeedKnots'],
  ['GROUND VELOCITY', 'knots', 'groundSpeedKnots'],
  ['PLANE ALTITUDE', 'feet', 'altitudeFt'],
  ['PLANE HEADING DEGREES MAGNETIC', 'degrees', 'headingDeg'],
  ['PLANE PITCH DEGREES', 'degrees', 'pitchDeg'],
  ['PLANE BANK DEGREES', 'degrees', 'bankDeg'],
  ['INCIDENCE BETA', 'degrees', 'sideslipDeg'],
  ['OVERSPEED WARNING', 'bool', 'overspeedWarning'],
  ['AILERON POSITION', 'position', 'aileronInput'],
  ['ELEVATOR POSITION', 'position', 'elevatorInput'],
  ['RUDDER POSITION', 'position', 'rudderInput'],
  ['GENERAL ENG THROTTLE LEVER POSITION:1', 'position', 'throttle1'],
  ['GENERAL ENG THROTTLE LEVER POSITION:2', 'position', 'throttle2'],
  ['BRAKE LEFT POSITION', 'position', 'brakeLeft'],
  ['BRAKE RIGHT POSITION', 'position', 'brakeRight'],
  ['TURB ENG N1:1', 'percent', 'engN1_1'],
  ['TURB ENG N1:2', 'percent', 'engN1_2'],
  ['TURB ENG N1:3', 'percent', 'engN1_3'],
  ['TURB ENG N1:4', 'percent', 'engN1_4'],
  ['TURB ENG N2:1', 'percent', 'engN2_1'],
  ['TURB ENG N2:2', 'percent', 'engN2_2'],
  ['TURB ENG N2:3', 'percent', 'engN2_3'],
  ['TURB ENG N2:4', 'percent', 'engN2_4'],
]

/** String SimVars (definition 2). [name, unit|null, stateKey, dataTypeName] */
const SIM_STRING_VARS = [
  ['TITLE', null, 'title', 'STRING256'],
  ['CATEGORY', null, 'category', 'STRING256'],
  ['ATC TYPE', null, 'atcType', 'STRING32'],
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
    indicatedAirspeedKnots: 0,
    groundSpeedKnots: 0,
    altitudeFt: 0,
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    sideslipDeg: 0,
    overspeedWarning: 0,
    aileronInput: 0,
    elevatorInput: 0,
    rudderInput: 0,
    throttle1: 0,
    throttle2: 0,
    brakeLeft: 0,
    brakeRight: 0,
    engN1_1: 0, engN1_2: 0, engN1_3: 0, engN1_4: 0,
    engN2_1: 0, engN2_2: 0, engN2_3: 0, engN2_4: 0,
    title: '',
    category: '',
    atcType: '',
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
  let simConnecting = false
  let simApplicationName = null
  let simError = false

  const openDevices = {}
  const motorIntensities = {}
  const hidErrorLogAt = {}
  const touchdown = createTouchdownTracker()
  const meta = { lastEngineType: -1, lastEnginesRunning: -1 }
  const state = createInitialFlightState()
  const flightEvents = createFlightEventDetector()
  const telemetryPublisher = createTelemetryPublisher()
  let lastUiTelemetry = null

  let sendInterval = null
  let rediscoverInterval = null
  let reconnectTimer = null
  let activeSimHandle = null
  let connectingSim = false
  let stopWaiters = []

  const now = options.now || (() => performance.now())
  const wallNow = options.wallNow || (() => Date.now())
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

  function simconnectStatus() {
    if (simError) return 'error'
    if (simConnected) return 'connected'
    if (simConnecting || connectingSim) return 'connecting'
    return 'disconnected'
  }

  function hidStatus() {
    return Object.keys(openDevices).length > 0 ? 'connected' : 'disconnected'
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

  function publishUiTelemetry(force = false) {
    const snapshot = buildTelemetrySnapshot(state, {
      simconnect: simconnectStatus(),
      hid: hidStatus(),
      hidOpenCount: Object.keys(openDevices).length,
      simConnected,
    }, wallNow())

    const events = flightEvents.observe(snapshot, wallNow())
    for (const ev of events) {
      emit('flightEvent', ev)
    }

    if (force) {
      telemetryPublisher.reset()
    }
    const published = force ? snapshot : telemetryPublisher.maybePublish(snapshot)
    if (published) {
      lastUiTelemetry = published
      emit('telemetry', published)
    }
    return published
  }

  function getTelemetry() {
    if (lastUiTelemetry) return lastUiTelemetry
    return buildTelemetrySnapshot(state, {
      simconnect: simconnectStatus(),
      hid: hidStatus(),
      hidOpenCount: Object.keys(openDevices).length,
      simConnected,
    }, wallNow())
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
    if (!activeSimHandle) {
      if (simConnected || simConnecting) {
        simConnected = false
        simConnecting = false
        simApplicationName = null
        emitState()
        publishUiTelemetry(true)
      }
      return
    }
    try { activeSimHandle.removeAllListeners?.() } catch (_) {}
    try {
      if (typeof activeSimHandle.close === 'function') activeSimHandle.close()
    } catch (_) {}
    activeSimHandle = null
    simConnected = false
    simConnecting = false
    simApplicationName = null
    emitState()
    publishUiTelemetry(true)
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

  function readStringField(data, dataTypeName) {
    if (!data) return ''
    try {
      if (dataTypeName === 'STRING32' && typeof data.readString32 === 'function') {
        return String(data.readString32() || '').replace(/\0/g, '').trim()
      }
      if (typeof data.readString256 === 'function') {
        return String(data.readString256() || '').replace(/\0/g, '').trim()
      }
      if (typeof data.readString === 'function') {
        return String(data.readString(dataTypeName === 'STRING32' ? 32 : 256) || '')
          .replace(/\0/g, '')
          .trim()
      }
    } catch (_) {
      return ''
    }
    return ''
  }

  function connectMSFS() {
    if ((status !== 'running' && status !== 'starting') || connectingSim) return
    if (!autoConnectSim) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    connectingSim = true
    simConnecting = true
    simError = false
    clearSimHandle()
    simConnecting = true
    emitState()
    publishUiTelemetry(true)
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
        simConnecting = false
        simError = false
        simApplicationName = recvOpen?.applicationName || 'MSFS'
        log('info', `[SIM] Connected: ${simApplicationName}`)
        emitState()
        publishUiTelemetry(true)

        for (const [varName, unit] of SIM_VARS) {
          handle.addToDataDefinition(
            DEF_ID, varName, unit,
            sc.SimConnectDataType.FLOAT64, 0.0,
            sc.SimConnectConstants.UNUSED,
          )
        }

        for (const [varName, unit, , dataTypeName] of SIM_STRING_VARS) {
          const dtype = sc.SimConnectDataType[dataTypeName] ?? sc.SimConnectDataType.STRING256
          handle.addToDataDefinition(
            DEF_ID_STRING, varName, unit,
            dtype, 0.0,
            sc.SimConnectConstants.UNUSED,
          )
        }

        handle.requestDataOnSimObject(
          REQ_ID, DEF_ID,
          sc.SimConnectConstants.OBJECT_ID_USER,
          sc.SimConnectPeriod.SIM_FRAME,
          0, 0, 0, 0,
        )

        handle.requestDataOnSimObject(
          REQ_ID_STRING, DEF_ID_STRING,
          sc.SimConnectConstants.OBJECT_ID_USER,
          sc.SimConnectPeriod.SIM_FRAME,
          0, 0, 0, 0,
        )

        handle.on('simObjectData', (recv) => {
          if (status !== 'running') return
          if (recv.requestID === REQ_ID) {
            for (const [, , key] of SIM_VARS) {
              state[key] = safeNumber(recv.data.readFloat64())
            }
            applyIntensities()
            publishUiTelemetry(false)
            return
          }
          if (recv.requestID === REQ_ID_STRING) {
            for (const [, , key, dataTypeName] of SIM_STRING_VARS) {
              state[key] = readStringField(recv.data, dataTypeName)
            }
            publishUiTelemetry(false)
          }
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
        simConnecting = false
        simConnected = false
        if (status !== 'running' && status !== 'starting') return
        log('warn', `[SIM] Not connected: ${err.message}`)
        emitState()
        publishUiTelemetry(true)
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
    simError = false
    flightEvents.reset()
    telemetryPublisher.reset()
    lastUiTelemetry = null
    emitState()
    publishUiTelemetry(true)

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
    simConnecting = false
    flightEvents.reset()
    telemetryPublisher.reset()
    finishStop()
    publishUiTelemetry(true)
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
      if (!(key in state)) continue
      if (typeof state[key] === 'string') {
        state[key] = value == null ? '' : String(value)
      } else {
        state[key] = safeNumber(value, state[key])
      }
    }
    applyIntensities()
    publishUiTelemetry(false)
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
    getTelemetry,
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
  SIM_STRING_VARS,
}
