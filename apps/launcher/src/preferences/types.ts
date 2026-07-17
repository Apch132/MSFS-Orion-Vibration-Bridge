/** Shared preference types for the desktop launcher (schema v1). */

import type { LocaleCode } from '../i18n'

export type ThemePreference = 'cockpit' | 'dark' | 'light' | 'system'
export type ActiveProfile = 'aircraft' | 'helicopter'
export type { LocaleCode }

export type EffectSettings = {
  enabled: boolean
  /**
   * Hardware ceiling for this effect, 0..100%.
   * 0 → HID 0, 50 → ~128, 100 → HID 255 (when the dynamic factor is 1).
   * Master multiplies the summed HID contribution last.
   */
  intensity: number
}

export type VibrationProfile = {
  master: EffectSettings
  engine: EffectSettings
  afterburner: EffectSettings
  gear: EffectSettings
  flaps: EffectSettings
  stall: EffectSettings
  touchdown: EffectSettings
  groundRoll: EffectSettings
  transonic: EffectSettings
}

export type LauncherPreferences = {
  schemaVersion: 1
  activeProfile: ActiveProfile
  profiles: {
    aircraft: VibrationProfile
    helicopter: VibrationProfile
  }
  appearance: {
    theme: ThemePreference
    /** UI language. Detected from OS on first launch, then persisted. */
    locale: LocaleCode
    /**
     * UI-only stick display invert.
     * Off (default): push stick → pip up, pull → pip down.
     * On: push → down, pull → up.
     * Does not alter SimConnect data.
     */
    reverseStickY: boolean
  }
}

export type EffectKey = keyof VibrationProfile

export const EFFECT_KEYS: EffectKey[] = [
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

export type SaveStatus = 'Saved' | 'Saving…' | 'Error'

export const PREFERENCES_STORE_FILE = 'launcher-preferences.json'
export const PREFERENCES_STORE_KEY = 'preferences'
export const CURRENT_SCHEMA_VERSION = 1 as const
