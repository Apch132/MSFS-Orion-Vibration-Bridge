import { getDefaultPreferences } from './defaults'
import type { PreferencesStorage } from './storage'
import {
  PREFERENCES_STORE_FILE,
  PREFERENCES_STORE_KEY,
  type LauncherPreferences,
  type SaveStatus,
} from './types'
import { clonePreferences, validateAndMigratePreferences } from './validate'

export type PreferencesChangeListener = (prefs: LauncherPreferences) => void
export type SaveStatusListener = (status: SaveStatus) => void

const DEFAULT_DEBOUNCE_MS = 300

/**
 * Owns preference state, validates on load, auto-saves with debounce,
 * and serializes writes so the latest mutation wins.
 */
export class PreferencesController {
  private prefs: LauncherPreferences = getDefaultPreferences()
  private status: SaveStatus = 'Saved'
  private dirty = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private readonly debounceMs: number
  private readonly onChange: Set<PreferencesChangeListener> = new Set()
  private readonly onStatus: Set<SaveStatusListener> = new Set()
  private saveCount = 0

  constructor(
    private readonly storage: PreferencesStorage,
    options?: { debounceMs?: number },
  ) {
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  getPreferences(): LauncherPreferences {
    return clonePreferences(this.prefs)
  }

  getSaveStatus(): SaveStatus {
    return this.status
  }

  /** Number of successful persisted writes (tests). */
  getSaveCount(): number {
    return this.saveCount
  }

  subscribe(listener: PreferencesChangeListener): () => void {
    this.onChange.add(listener)
    return () => this.onChange.delete(listener)
  }

  subscribeStatus(listener: SaveStatusListener): () => void {
    this.onStatus.add(listener)
    return () => this.onStatus.delete(listener)
  }

  async loadPreferences(): Promise<LauncherPreferences> {
    try {
      const raw = await this.storage.read()
      if (raw == null) {
        this.prefs = getDefaultPreferences()
        this.setStatus('Saved')
        this.dirty = false
        this.emit()
        return this.getPreferences()
      }
      this.prefs = validateAndMigratePreferences(raw)
      this.setStatus('Saved')
      this.dirty = false
      this.emit()
      return this.getPreferences()
    } catch (err) {
      console.error('[prefs] load failed, using defaults:', err)
      this.prefs = getDefaultPreferences()
      this.setStatus('Error')
      this.dirty = false
      this.emit()
      return this.getPreferences()
    }
  }

  /**
   * Apply a mutation and schedule a debounced save.
   * Always validates/clamps through validateAndMigratePreferences.
   */
  updatePreferences(
    mutator: (current: LauncherPreferences) => LauncherPreferences,
  ): LauncherPreferences {
    const next = validateAndMigratePreferences(mutator(clonePreferences(this.prefs)))
    this.prefs = next
    this.dirty = true
    this.setStatus('Saving…')
    this.emit()
    this.scheduleSave()
    return this.getPreferences()
  }

  async savePreferences(preferences?: LauncherPreferences): Promise<LauncherPreferences> {
    if (preferences) {
      this.prefs = validateAndMigratePreferences(preferences)
      this.emit()
    }
    this.dirty = true
    await this.flushSave()
    return this.getPreferences()
  }

  async resetPreferences(): Promise<LauncherPreferences> {
    this.prefs = getDefaultPreferences()
    this.dirty = true
    this.setStatus('Saving…')
    this.emit()
    await this.flushSave()
    return this.getPreferences()
  }

  /** Cancel debounce and persist any pending change (call on window close). */
  async flushPendingSave(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.dirty) {
      await this.flushSave()
    } else {
      await this.writeChain
    }
  }

  private scheduleSave(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.flushSave()
    }, this.debounceMs)
  }

  private flushSave(): Promise<void> {
    const snapshot = clonePreferences(this.prefs)
    this.writeChain = this.writeChain
      .catch(() => {
        /* keep chain alive after prior error */
      })
      .then(async () => {
        try {
          this.setStatus('Saving…')
          await this.storage.write(snapshot)
          // Only clear dirty if no newer mutation happened while writing
          if (JSON.stringify(this.prefs) === JSON.stringify(snapshot)) {
            this.dirty = false
          }
          this.saveCount += 1
          this.setStatus(this.dirty ? 'Saving…' : 'Saved')
          if (this.dirty && !this.debounceTimer) {
            this.scheduleSave()
          }
        } catch (err) {
          console.error('[prefs] save failed:', err)
          this.setStatus('Error')
          throw err
        }
      })
    return this.writeChain
  }

  private emit(): void {
    const snap = this.getPreferences()
    for (const listener of this.onChange) listener(snap)
  }

  private setStatus(status: SaveStatus): void {
    this.status = status
    for (const listener of this.onStatus) listener(status)
  }
}

export async function createTauriPreferencesStorage(): Promise<PreferencesStorage> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(PREFERENCES_STORE_FILE, {
    autoSave: false,
    defaults: {},
  })

  return {
    async read() {
      const value = await store.get<unknown>(PREFERENCES_STORE_KEY)
      return value === undefined ? null : value
    },
    async write(preferences) {
      await store.set(PREFERENCES_STORE_KEY, preferences)
      await store.save()
    },
    async clear() {
      await store.delete(PREFERENCES_STORE_KEY)
      await store.save()
    },
  }
}

export type { PreferencesStorage } from './storage'
export { MemoryPreferencesStorage } from './storage'
export {
  getDefaultPreferences,
  validateAndMigratePreferences,
  clonePreferences,
}
