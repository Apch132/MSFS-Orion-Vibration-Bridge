import { detectSystemLocale } from '../i18n'
import type { EffectSettings, LauncherPreferences, VibrationProfile } from './types'
import { CURRENT_SCHEMA_VERSION } from './types'

function effect(intensity = 100, enabled = true): EffectSettings {
  return { enabled, intensity }
}

/**
 * Defaults match historical feel-unit peaks as HID ceilings (see docs/INTENSITY.md).
 * 100% = full HID 255 when dynamicFactor is 1 — not “legacy feel”.
 */
function defaultAircraftProfile(): VibrationProfile {
  return {
    master: effect(100),
    engine: effect(18),
    afterburner: effect(30),
    gear: effect(35),
    flaps: effect(18),
    stall: effect(70),
    touchdown: effect(100),
    groundRoll: effect(40),
    transonic: effect(55),
  }
}

function defaultHelicopterProfile(): VibrationProfile {
  return {
    master: effect(100),
    engine: effect(40),
    afterburner: effect(0, false),
    gear: effect(45),
    flaps: effect(0, false),
    stall: effect(56),
    touchdown: effect(100),
    groundRoll: effect(40),
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
      locale: detectSystemLocale(),
      reverseStickY: false,
      configPanelWidthPx: 360,
    },
  }
}
