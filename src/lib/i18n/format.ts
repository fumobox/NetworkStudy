import type { Locale } from './locale'

const BCP47: Readonly<Record<Locale, string>> = {
  en: 'en-US',
  ja: 'ja-JP',
}

export function toBcp47(locale: Locale): string {
  return BCP47[locale]
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(toBcp47(locale), options).format(value)
}
