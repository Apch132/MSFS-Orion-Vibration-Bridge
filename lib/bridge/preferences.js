/**
 * Bridge-side preference defaults and validation (CommonJS).
 * CLI uses these defaults; the launcher sends its own validated prefs via updatePreferences.
 * Not read from the Tauri store by the CLI.
 */

'use strict'

const EFFECT_KEYS = [
  'master',
  'engine',
  'afterburner',
  'gear',
  'flaps',
  'stall',
  'touchdown',
  'groundRoll',
  'transonic',
]

function effect(intensity = 100, enabled = true) {
  return { enabled, intensity }
}

function defaultAircraftProfile() {
  return {
    master: effect(100),
    engine: effect(100),
    afterburner: effect(100),
    gear: effect(100),
    flaps: effect(100),
    stall: effect(100),
    touchdown: effect(100),
    groundRoll: effect(80),
    transonic: effect(100),
  }
}

function defaultHelicopterProfile() {
  return {
    master: effect(100),
    engine: effect(90),
    afterburner: effect(0, false),
    gear: effect(70),
    flaps: effect(0, false),
    stall: effect(80),
    touchdown: effect(100),
    groundRoll: effect(60),
    transonic: effect(0, false),
  }
}

function getDefaultBridgePreferences() {
  return {
    schemaVersion: 1,
    activeProfile: 'aircraft',
    profiles: {
      aircraft: defaultAircraftProfile(),
      helicopter: defaultHelicopterProfile(),
    },
    appearance: {
      theme: 'cockpit',
    },
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampIntensity(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

function normalizeEffect(raw, fallback) {
  if (!isPlainObject(raw)) {
    return { enabled: fallback.enabled, intensity: fallback.intensity }
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    intensity: clampIntensity(raw.intensity, fallback.intensity),
  }
}

function normalizeProfile(raw, fallback) {
  const src = isPlainObject(raw) ? raw : {}
  const out = {}
  for (const key of EFFECT_KEYS) {
    out[key] = normalizeEffect(src[key], fallback[key])
  }
  return out
}

function validateBridgePreferences(raw) {
  const defaults = getDefaultBridgePreferences()
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults
  }
  const obj = raw
  const profilesRaw = isPlainObject(obj.profiles) ? obj.profiles : {}
  const appearanceRaw = isPlainObject(obj.appearance) ? obj.appearance : {}
  const theme = appearanceRaw.theme
  return {
    schemaVersion: 1,
    activeProfile: obj.activeProfile === 'helicopter' ? 'helicopter' : 'aircraft',
    profiles: {
      aircraft: normalizeProfile(profilesRaw.aircraft, defaults.profiles.aircraft),
      helicopter: normalizeProfile(profilesRaw.helicopter, defaults.profiles.helicopter),
    },
    appearance: {
      theme:
        theme === 'dark' || theme === 'light' || theme === 'system' || theme === 'cockpit'
          ? theme
          : defaults.appearance.theme,
    },
  }
}

/** Scale a 0..1 dynamic factor by an effect slider into a HID contribution 0..255.
 *  effectOutput = dynamicFactor * (effectSlider / 100) * 255
 */
function scaleEffect(effectSettings, dynamicFactor) {
  if (!effectSettings || !effectSettings.enabled) return 0
  const intensity = clampIntensity(effectSettings.intensity, 100)
  const f = Number(dynamicFactor)
  if (!Number.isFinite(f) || f <= 0) return 0
  const factor = Math.min(1, Math.max(0, f))
  return factor * (intensity / 100) * 255
}

/** Apply Master last: finalOutput = clamp(sum * (master / 100), 0, 255). */
function applyMaster(effectSettings, hidSum) {
  if (!effectSettings || !effectSettings.enabled) return 0
  const intensity = clampIntensity(effectSettings.intensity, 100)
  const n = Number(hidSum)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(255, Math.max(0, n * (intensity / 100)))
}

function activeProfileSettings(preferences) {
  const prefs = validateBridgePreferences(preferences)
  return prefs.profiles[prefs.activeProfile] || prefs.profiles.aircraft
}

module.exports = {
  EFFECT_KEYS,
  getDefaultBridgePreferences,
  validateBridgePreferences,
  scaleEffect,
  applyMaster,
  activeProfileSettings,
}
