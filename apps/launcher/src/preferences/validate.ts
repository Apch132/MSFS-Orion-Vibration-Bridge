import { getDefaultPreferences } from './defaults'
import {
  CURRENT_SCHEMA_VERSION,
  EFFECT_KEYS,
  type ActiveProfile,
  type EffectSettings,
  type LauncherPreferences,
  type ThemePreference,
  type VibrationProfile,
} from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampIntensity(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function normalizeEffect(raw: unknown, fallback: EffectSettings): EffectSettings {
  if (!isPlainObject(raw)) {
    return { enabled: fallback.enabled, intensity: fallback.intensity }
  }
  return {
    enabled: asBoolean(raw.enabled, fallback.enabled),
    intensity: clampIntensity(raw.intensity, fallback.intensity),
  }
}

function normalizeProfile(raw: unknown, fallback: VibrationProfile): VibrationProfile {
  const src = isPlainObject(raw) ? raw : {}
  const out = {} as VibrationProfile
  for (const key of EFFECT_KEYS) {
    out[key] = normalizeEffect(src[key], fallback[key])
  }
  return out
}

function normalizeTheme(value: unknown, fallback: ThemePreference): ThemePreference {
  if (value === 'cockpit' || value === 'dark' || value === 'light' || value === 'system') {
    return value
  }
  return fallback
}

function normalizeActiveProfile(value: unknown, fallback: ActiveProfile): ActiveProfile {
  if (value === 'aircraft' || value === 'helicopter') return value
  return fallback
}

/**
 * Validate, clamp, fill missing fields, and migrate toward schema v1.
 * Unknown keys on the root object are ignored. Never throws.
 */
export function validateAndMigratePreferences(raw: unknown): LauncherPreferences {
  const defaults = getDefaultPreferences()

  if (raw == null || typeof raw !== 'object') {
    return defaults
  }

  // Tolerate non-object JSON roots (string, array, number)
  if (Array.isArray(raw) || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return defaults
  }

  const obj = raw as Record<string, unknown>
  const versionRaw = obj.schemaVersion
  const version = typeof versionRaw === 'number' && Number.isFinite(versionRaw)
    ? Math.trunc(versionRaw)
    : 0

  // Future: branch on version < CURRENT and transform.
  // Today every known/unknown version is normalized into schema v1.
  void version

  const profilesRaw = isPlainObject(obj.profiles) ? obj.profiles : {}
  const appearanceRaw = isPlainObject(obj.appearance) ? obj.appearance : {}

  const migrated: LauncherPreferences = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeProfile: normalizeActiveProfile(obj.activeProfile, defaults.activeProfile),
    profiles: {
      aircraft: normalizeProfile(profilesRaw.aircraft, defaults.profiles.aircraft),
      helicopter: normalizeProfile(profilesRaw.helicopter, defaults.profiles.helicopter),
    },
    appearance: {
      theme: normalizeTheme(appearanceRaw.theme, defaults.appearance.theme),
    },
  }

  return migrated
}

export function clonePreferences(prefs: LauncherPreferences): LauncherPreferences {
  return structuredClone(prefs)
}
