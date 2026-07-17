/** Shared preference types for the desktop launcher (schema v1). */

export type ThemePreference = 'cockpit' | 'dark' | 'light' | 'system'
export type ActiveProfile = 'aircraft' | 'helicopter'

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

export const EFFECT_LABELS: Record<EffectKey, string> = {
  master: 'Master (global)',
  engine: 'Engine',
  afterburner: 'Afterburner',
  gear: 'Gear',
  flaps: 'Flaps',
  stall: 'Stall',
  touchdown: 'Touchdown',
  groundRoll: 'Ground roll',
  transonic: 'Transonic',
}

export type SaveStatus = 'Saved' | 'Saving…' | 'Error'

export const PREFERENCES_STORE_FILE = 'launcher-preferences.json'
export const PREFERENCES_STORE_KEY = 'preferences'
export const CURRENT_SCHEMA_VERSION = 1 as const
