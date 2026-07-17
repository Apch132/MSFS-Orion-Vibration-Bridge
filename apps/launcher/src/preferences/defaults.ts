import type { EffectSettings, LauncherPreferences, VibrationProfile } from './types'
import { CURRENT_SCHEMA_VERSION } from './types'

function effect(intensity = 100, enabled = true): EffectSettings {
  return { enabled, intensity }
}

function defaultAircraftProfile(): VibrationProfile {
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

function defaultHelicopterProfile(): VibrationProfile {
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

/** Single source of truth for launcher preference defaults (not used by CLI). */
export function getDefaultPreferences(): LauncherPreferences {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
