import './styles.css'
import { LauncherBridgeClient } from './bridge-client'
import {
  PreferencesController,
  MemoryPreferencesStorage,
  createTauriPreferencesStorage,
  getDefaultPreferences,
} from './preferences'
import { mountApp } from './ui/app'

async function boot(): Promise<void> {
  const root = document.querySelector('#app')
  if (!root) throw new Error('#app root missing')

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  const storage = isTauri
    ? await createTauriPreferencesStorage()
    : new MemoryPreferencesStorage(getDefaultPreferences())

  const controller = new PreferencesController(storage)
  await controller.loadPreferences()

  const bridge = new LauncherBridgeClient()
  if (isTauri) {
    try {
      await bridge.connect()
    } catch (err) {
      console.error('[launcher] bridge host unavailable:', err)
    }
  }

  let quitting = false

  const requestQuit = async (): Promise<void> => {
    if (quitting) return
    quitting = true
    try {
      await controller.flushPendingSave()
      await bridge.dispose()
    } catch (err) {
      console.error('[launcher] quit cleanup failed:', err)
    } finally {
      if (isTauri) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().destroy()
        } catch (err) {
          console.error('[launcher] window destroy failed:', err)
          quitting = false
        }
      }
    }
  }

  await mountApp(root as HTMLElement, controller, {
    bridge,
    onRequestQuit: isTauri ? requestQuit : undefined,
  })

  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    // Alt+F4 / taskbar close / custom Close all go through here.
    await win.onCloseRequested(async (event) => {
      event.preventDefault()
      await requestQuit()
    })
  } else {
    console.info('[launcher] Browser preview uses in-memory preferences (Tauri store inactive).')
  }
}

boot().catch((err) => {
  console.error('[launcher] failed to start:', err)
  const root = document.querySelector('#app')
  if (root) {
    root.innerHTML = `<div style="padding:24px;font-family:sans-serif;color:#d45b5b">Launcher failed to start. See console.</div>`
  }
})
