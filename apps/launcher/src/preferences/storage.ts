import type { LauncherPreferences } from './types'

/** Abstraction so preferences logic can be tested without touching OS app data. */
export interface PreferencesStorage {
  read(): Promise<unknown | null>
  write(preferences: LauncherPreferences): Promise<void>
  clear(): Promise<void>
}

export class MemoryPreferencesStorage implements PreferencesStorage {
  private value: unknown | null = null

  constructor(initial: unknown | null = null) {
    this.value = initial
  }

  async read(): Promise<unknown | null> {
    return this.value === undefined ? null : structuredClone(this.value)
  }

  async write(preferences: LauncherPreferences): Promise<void> {
    this.value = structuredClone(preferences)
  }

  async clear(): Promise<void> {
    this.value = null
  }

  /** Test helper */
  seed(raw: unknown | null): void {
    this.value = raw === null ? null : structuredClone(raw)
  }

  snapshot(): unknown | null {
    return this.value === null ? null : structuredClone(this.value)
  }
}
