import { en, type LocaleCode, type MessageTree } from './en'
import { fr } from './fr'

const catalogs: Record<LocaleCode, MessageTree> = { en, fr }

/** Detect OS / browser UI language. Fallback: English. */
export function detectSystemLocale(
  language = typeof navigator !== 'undefined' ? navigator.language : 'en',
): LocaleCode {
  const tag = String(language || 'en').toLowerCase()
  if (tag === 'fr' || tag.startsWith('fr-')) return 'fr'
  return 'en'
}

export function normalizeLocale(value: unknown, fallback: LocaleCode = 'en'): LocaleCode {
  if (value === 'fr' || value === 'en') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower === 'fr' || lower.startsWith('fr-')) return 'fr'
    if (lower === 'en' || lower.startsWith('en-')) return 'en'
  }
  return fallback
}

export function getMessages(locale: LocaleCode): MessageTree {
  return catalogs[locale] ?? catalogs.en
}

/** Replace `{name}` placeholders in a message template. */
export function formatMessage(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key]
    return v == null ? `{${key}}` : String(v)
  })
}

export type { LocaleCode, MessageTree }
export { en, fr }
