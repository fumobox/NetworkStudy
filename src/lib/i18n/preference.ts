import { z } from 'zod'
import { readStorage, writeStorage } from '../storage'
import { LOCALES, type Locale } from './locale'

export const LOCALE_STORAGE_KEY = 'ns.locale'

const localeSchema = z.enum(LOCALES)

export function readPreferredLocale(): Locale | null {
  return readStorage(LOCALE_STORAGE_KEY, localeSchema)
}

export function savePreferredLocale(locale: Locale): void {
  writeStorage(LOCALE_STORAGE_KEY, locale)
}
