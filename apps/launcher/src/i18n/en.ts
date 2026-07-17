/** Locale codes supported by the launcher. */
export type LocaleCode = 'en' | 'fr'

export type MessageTree = {
  app: {
    title: string
    subtitle: string
    dragHint: string
  }
  window: {
    minimize: string
    maximize: string
    restore: string
    close: string
  }
  bridge: {
    start: string
    stop: string
    startTitle: string
    unavailableTitle: string
    runningFooter: string
    idleFooter: string
    errorPrefix: string
  }
  sim: {
    title: string
    disconnected: string
    connecting: string
    connected: string
    error: string
  }
  hid: {
    disconnected: string
    connected: string
    error: string
  }
  panels: {
    railLabel: string
    config: string
    flight: string
    show: string
    hide: string
    allHiddenTitle: string
    allHiddenHint: string
    resize: string
    resizeHint: string
  }
  config: {
    helpLead: string
    helpBody: string
    helpGear: string
    helpTouchdown: string
    helpStallLight: string
    helpStallHard: string
    helpCeiling: string
    helpScale: string
    profileAircraft: string
    profileHelicopter: string
    theme: string
    themeCockpit: string
    themeDark: string
    themeLight: string
    themeSystem: string
    language: string
    languageEn: string
    languageFr: string
    resetHint: string
    reset: string
    enableEffect: string
    masterHint: string
    ceilingHint: string
  }
  effects: {
    master: string
    engine: string
    afterburner: string
    gear: string
    flaps: string
    stall: string
    touchdown: string
    groundRoll: string
    transonic: string
  }
  save: {
    saved: string
    saving: string
    error: string
  }
  flight: {
    aircraft: string
    name: string
    category: string
    type: string
    engines: string
    flightData: string
    aircraftState: string
    controls: string
    enginesCard: string
    events: string
    phase: string
    helicopter: string
    airplane: string
    onGround: string
    airborne: string
    reverseStick: string
    windConvention: string
    eng: string
    na: string
    idle: string
    off: string
    on: string
  }
  events: {
    takeoff: string
    gear_up: string
    flaps_retracted: string
    mach_1: string
    landing: string
    touchdown: string
  }
  hud: {
    aria: string
    windFrom: string
  }
}

export const en: MessageTree = {
  app: {
    title: 'WinWing MSFS Vibration Bridge',
    subtitle: 'Desktop launcher',
    dragHint: 'Drag to move · double-click to maximize',
  },
  window: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },
  bridge: {
    start: 'Start',
    stop: 'Stop',
    startTitle: 'Start or stop the shared vibration bridge',
    unavailableTitle: 'Bridge runtime requires the Tauri desktop app',
    runningFooter: 'Bridge running — preference changes apply live',
    idleFooter: 'Preferences stored in the OS app data directory',
    errorPrefix: 'Bridge error:',
  },
  sim: {
    title: 'SimConnect status from the shared bridge runtime',
    disconnected: 'SimConnect · Disconnected',
    connecting: 'SimConnect · Connecting',
    connected: 'SimConnect · Connected',
    error: 'SimConnect · Error',
  },
  hid: {
    disconnected: 'HID · Disconnected',
    connected: 'HID · Connected',
    error: 'HID · Error',
  },
  panels: {
    railLabel: 'Panel visibility',
    config: 'Configuration',
    flight: 'Flight',
    show: 'Show',
    hide: 'Hide',
    allHiddenTitle: 'All panels are hidden.',
    allHiddenHint: 'Use the buttons on the left to show Configuration or Flight.',
    resize: 'Resize panels',
    resizeHint: 'Drag to resize · double-click to reset',
  },
  config: {
    helpLead: 'Sliders do not make an effect more frequent. They only set its maximum power.',
    helpBody: 'The vibration engine automatically adapts intensity to the flight situation.',
    helpGear: 'Retracting gear: light vibration.',
    helpTouchdown: 'Hard landing: much stronger vibration.',
    helpStallLight: 'Light stall: moderate vibration.',
    helpStallHard: 'Deep stall: strong vibration.',
    helpCeiling: 'Lowering a slider only limits that effect’s maximum power. Master scales every effect.',
    helpScale: 'HID scale: 0% = 0 · 50% ≈ 128 · 100% = 255',
    profileAircraft: 'Aircraft',
    profileHelicopter: 'Helicopter',
    theme: 'Theme',
    themeCockpit: 'Cockpit',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeSystem: 'System',
    language: 'Language',
    languageEn: 'English',
    languageFr: 'Français',
    resetHint: 'Restore both profiles, theme, and language',
    reset: 'Reset defaults',
    enableEffect: 'Enable',
    masterHint: 'Final HID multiplier',
    ceilingHint: 'Ceiling ≈ {n} HID',
  },
  effects: {
    master: 'Master (global)',
    engine: 'Engine',
    afterburner: 'Afterburner',
    gear: 'Gear',
    flaps: 'Flaps',
    stall: 'Stall',
    touchdown: 'Touchdown',
    groundRoll: 'Ground roll',
    transonic: 'Transonic',
  },
  save: {
    saved: 'Saved',
    saving: 'Saving…',
    error: 'Error',
  },
  flight: {
    aircraft: 'Aircraft',
    name: 'Name',
    category: 'Category',
    type: 'Type',
    engines: 'Engines',
    flightData: 'Flight Data',
    aircraftState: 'Aircraft State',
    controls: 'Controls',
    enginesCard: 'Engines',
    events: 'Flight Events',
    phase: 'Phase',
    helicopter: 'Helicopter',
    airplane: 'Airplane',
    onGround: 'On ground',
    airborne: 'Airborne',
    reverseStick: 'Reverse vertical axis',
    windConvention:
      'Wind arrow shows where the wind comes FROM (meteorological convention). Length scales with speed.',
    eng: 'Eng',
    na: 'N/A',
    idle: 'IDLE',
    off: 'OFF',
    on: 'ON',
  },
  events: {
    takeoff: 'Takeoff',
    gear_up: 'Gear Up',
    flaps_retracted: 'Flaps Retracted',
    mach_1: 'Mach 1',
    landing: 'Landing',
    touchdown: 'Touchdown',
  },
  hud: {
    aria: 'Flight HUD',
    windFrom: 'Wind from',
  },
}
