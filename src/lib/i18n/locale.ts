export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

/** 翻訳対象のテキスト。すべてのロケールの訳が必須 */
export type LocalizedText = Readonly<Record<Locale, string>>

export function pickText(text: LocalizedText, locale: Locale): string {
  return text[locale]
}
