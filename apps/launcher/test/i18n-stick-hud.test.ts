import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectSystemLocale,
  formatMessage,
  getMessages,
  normalizeLocale,
} from '../src/i18n'
import {
  applyStickPipPosition,
  normalizeStickAxis,
  stickDisplayY,
  STICK_TRAVEL,
} from '../src/ui/stick'
import { windArrowAngleDeg, windArrowLengthPx } from '../src/ui/hud'
import {
  getDefaultPreferences,
  validateAndMigratePreferences,
  MemoryPreferencesStorage,
  PreferencesController,
} from '../src/preferences'

describe('i18n', () => {
  it('detects French from OS language tags', () => {
    assert.equal(detectSystemLocale('fr'), 'fr')
    assert.equal(detectSystemLocale('fr-FR'), 'fr')
    assert.equal(detectSystemLocale('fr-CA'), 'fr')
  })

  it('falls back to English', () => {
    assert.equal(detectSystemLocale('en'), 'en')
    assert.equal(detectSystemLocale('de-DE'), 'en')
    assert.equal(detectSystemLocale(''), 'en')
    assert.equal(normalizeLocale('nope', 'en'), 'en')
  })

  it('returns catalogs with shared keys', () => {
    const en = getMessages('en')
    const fr = getMessages('fr')
    assert.equal(en.bridge.start, 'Start')
    assert.equal(fr.bridge.start, 'Démarrer')
    assert.ok(fr.config.helpLead.includes('curseurs'))
    assert.equal(formatMessage(en.config.ceilingHint, { n: 128 }), 'Ceiling ≈ 128 HID')
  })

  it('persists locale preference', async () => {
    const storage = new MemoryPreferencesStorage(null)
    const controller = new PreferencesController(storage, { debounceMs: 10 })
    await controller.loadPreferences()
    controller.updatePreferences((c) => ({
      ...c,
      appearance: { ...c.appearance, locale: 'fr' },
    }))
    await controller.flushPendingSave()
    const stored = storage.snapshot() as { appearance: { locale: string } }
    assert.equal(stored.appearance.locale, 'fr')
  })

  it('fills missing locale from defaults without wiping reverseStickY', () => {
    const prefs = validateAndMigratePreferences({
      appearance: { theme: 'dark', reverseStickY: true },
    })
    assert.equal(prefs.appearance.theme, 'dark')
    assert.equal(prefs.appearance.reverseStickY, true)
    assert.ok(prefs.appearance.locale === 'en' || prefs.appearance.locale === 'fr')
  })
})

describe('stick axis', () => {
  it('centers and clamps signed POSITION', () => {
    assert.equal(normalizeStickAxis(0), 0)
    assert.equal(normalizeStickAxis(1), 1)
    assert.equal(normalizeStickAxis(-1), -1)
    assert.equal(normalizeStickAxis(2), 1)
    assert.equal(normalizeStickAxis(undefined), 0)
  })

  it('maps percent-style 0..100 with 50 center when clearly percent', () => {
    assert.equal(normalizeStickAxis(50), 0)
    assert.equal(normalizeStickAxis(100), 1)
    assert.equal(normalizeStickAxis(0), 0)
    assert.equal(normalizeStickAxis(75), 0.5)
    assert.equal(normalizeStickAxis(2), 1) // POSITION overshoot, not percent
  })

  it('default display: push up / pull down', () => {
    // MSFS: push = negative elevator
    assert.ok(stickDisplayY(-1, false) < 0) // up in top%
    assert.ok(stickDisplayY(1, false) > 0) // down
  })

  it('reverse flips vertical only', () => {
    assert.equal(stickDisplayY(-1, true), 1)
    assert.equal(stickDisplayY(1, true), -1)
    assert.equal(stickDisplayY(0, true), 0)
  })

  it('positions pip with left/top relative to stick box', () => {
    const pip = {
      style: { left: '', top: '', transform: '' },
    } as unknown as HTMLElement
    applyStickPipPosition(pip, { stickX: 1, stickY: -1 }, { reverseStickY: false })
    assert.equal(pip.style.left, `${50 + STICK_TRAVEL * 50}%`)
    assert.equal(pip.style.top, `${50 - STICK_TRAVEL * 50}%`)
    assert.equal(pip.style.transform, 'translate(-50%, -50%)')
  })
})

describe('HUD wind', () => {
  it('arrow angle uses FROM convention (points TO = from+180)', () => {
    assert.equal(windArrowAngleDeg(0), 180)
    assert.equal(windArrowAngleDeg(90), 270)
    assert.equal(windArrowAngleDeg(180), 0)
  })

  it('arrow length scales with speed and hides at 0', () => {
    assert.equal(windArrowLengthPx(0), 0)
    assert.ok(windArrowLengthPx(10) > 0)
    assert.ok(windArrowLengthPx(40) >= windArrowLengthPx(10))
  })

  it('defaults include reverseStickY false', () => {
    assert.equal(getDefaultPreferences().appearance.reverseStickY, false)
  })
})
