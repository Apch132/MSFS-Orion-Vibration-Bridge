/** Shared preference types for the desktop launcher (schema v1). */

export type ThemePreference = 'cockpit' | 'dark' | 'light' | 'system'
export type ActiveProfile = 'aircraft' | 'helicopter'

export type EffectSettings = {
  enabled: boolean
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
  master: 'Master',
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
