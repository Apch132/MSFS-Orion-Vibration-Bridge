import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PreferencesController,
  MemoryPreferencesStorage,
  getDefaultPreferences,
  validateAndMigratePreferences,
} from '../src/preferences/index'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('launcher preferences', () => {
  it('loads defaults when no file exists', async () => {
    const storage = new MemoryPreferencesStorage(null)
    const controller = new PreferencesController(storage, { debounceMs: 20 })
    const prefs = await controller.loadPreferences()
    assert.deepEqual(prefs, getDefaultPreferences())
    assert.equal(prefs.appearance.theme, 'cockpit')
  })

  it('clamps intensities to 0..100', () => {
    const raw = getDefaultPreferences()
    raw.profiles.aircraft.engine.intensity = 50
    const ok = validateAndMigratePreferences(raw)
    assert.equal(ok.profiles.aircraft.engine.intensity, 50)

    raw.profiles.aircraft.engine.intensity = -12
    assert.equal(validateAndMigratePreferences(raw).profiles.aircraft.engine.intensity, 0)

    raw.profiles.aircraft.engine.intensity = 140
    assert.equal(validateAndMigratePreferences(raw).profiles.aircraft.engine.intensity, 100)
  })

  it('recovers from corrupt payloads', () => {
    assert.deepEqual(validateAndMigratePreferences(null), getDefaultPreferences())
    assert.deepEqual(validateAndMigratePreferences('not-json-object'), getDefaultPreferences())
    assert.deepEqual(validateAndMigratePreferences([1, 2, 3]), getDefaultPreferences())
    assert.deepEqual(validateAndMigratePreferences(42), getDefaultPreferences())
  })

  it('fills missing fields from defaults', () => {
    const partial = {
      activeProfile: 'helicopter',
      profiles: {
        aircraft: {
          master: { enabled: true, intensity: 40 },
        },
      },
    }
    const prefs = validateAndMigratePreferences(partial)
    assert.equal(prefs.schemaVersion, 1)
    assert.equal(prefs.activeProfile, 'helicopter')
    assert.equal(prefs.profiles.aircraft.master.intensity, 40)
    assert.equal(prefs.profiles.aircraft.engine.intensity, 18)
    assert.equal(prefs.profiles.helicopter.master.enabled, true)
    assert.equal(prefs.appearance.theme, 'cockpit')
  })

  it('migrates objects without schemaVersion into v1', () => {
    const legacy = {
      activeProfile: 'aircraft',
      profiles: {
        aircraft: getDefaultPreferences().profiles.aircraft,
        helicopter: getDefaultPreferences().profiles.helicopter,
      },
      appearance: { theme: 'dark' },
    }
    const prefs = validateAndMigratePreferences(legacy)
    assert.equal(prefs.schemaVersion, 1)
    assert.equal(prefs.appearance.theme, 'dark')
  })

  it('keeps aircraft and helicopter profiles independent', async () => {
    const storage = new MemoryPreferencesStorage(null)
    const controller = new PreferencesController(storage, { debounceMs: 15 })
    await controller.loadPreferences()

    controller.updatePreferences((current) => ({
      ...current,
      activeProfile: 'aircraft',
      profiles: {
        ...current.profiles,
        aircraft: {
          ...current.profiles.aircraft,
          engine: { enabled: true, intensity: 33 },
        },
      },
    }))

    controller.updatePreferences((current) => ({
      ...current,
      activeProfile: 'helicopter',
      profiles: {
        ...current.profiles,
        helicopter: {
          ...current.profiles.helicopter,
          engine: { enabled: true, intensity: 77 },
        },
      },
    }))

    await controller.flushPendingSave()
    const prefs = controller.getPreferences()
    assert.equal(prefs.profiles.aircraft.engine.intensity, 33)
    assert.equal(prefs.profiles.helicopter.engine.intensity, 77)
  })

  it('resets completely to defaults', async () => {
    const storage = new MemoryPreferencesStorage(null)
    const controller = new PreferencesController(storage, { debounceMs: 10 })
    await controller.loadPreferences()
    controller.updatePreferences((current) => ({
      ...current,
      appearance: { theme: 'light' },
      profiles: {
        ...current.profiles,
        aircraft: {
          ...current.profiles.aircraft,
          master: { enabled: false, intensity: 10 },
        },
      },
    }))
    await controller.resetPreferences()
    assert.deepEqual(controller.getPreferences(), getDefaultPreferences())
  })

  it('debounces rapid changes into one coherent final save', async () => {
    const storage = new MemoryPreferencesStorage(null)
    const controller = new PreferencesController(storage, { debounceMs: 40 })
    await controller.loadPreferences()

    for (let i = 1; i <= 8; i++) {
      controller.updatePreferences((current) => ({
        ...current,
        profiles: {
          ...current.profiles,
          aircraft: {
            ...current.profiles.aircraft,
            master: { enabled: true, intensity: i * 10 },
          },
        },
      }))
    }

    await sleep(20)
    assert.equal(controller.getSaveCount(), 0)
    await sleep(50)
    await controller.flushPendingSave()

    assert.ok(controller.getSaveCount() >= 1)
    assert.equal(controller.getPreferences().profiles.aircraft.master.intensity, 80)
    const stored = storage.snapshot() as { profiles: { aircraft: { master: { intensity: number } } } }
    assert.equal(stored.profiles.aircraft.master.intensity, 80)
  })

  it('ignores unknown keys without crashing', () => {
    const prefs = validateAndMigratePreferences({
      schemaVersion: 1,
      extraFutureField: { nested: true },
      appearance: { theme: 'system', unused: 1 },
      profiles: {
        aircraft: {
          master: { enabled: true, intensity: 55, mystery: true },
          engine: { enabled: true, intensity: 20 },
        },
      },
    })
    assert.equal(prefs.appearance.theme, 'system')
    assert.equal(prefs.profiles.aircraft.master.intensity, 55)
    assert.equal(prefs.profiles.aircraft.flaps.intensity, 18)
  })
})
