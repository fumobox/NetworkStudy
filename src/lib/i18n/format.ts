import type { Locale } from './locale'

const BCP47: Readonly<Record<Locale, string>> = {
  en: 'en-US',
  ja: 'ja-JP',
}

export function toBcp47(locale: Locale): string {
  return BCP47[locale]
}

/** 秒の表示形式。ja は narrow だと `1s` になるため short（`1 秒`）にする */
const SECOND_UNIT_DISPLAY: Readonly<Record<Locale, Intl.NumberFormatOptions['unitDisplay']>> = {
  en: 'narrow',
  ja: 'short',
}

/** ミリ秒を秒として整形する（`1500` → en: `1.5s`, ja: `1.5 秒`） */
export function formatSeconds(locale: Locale, ms: number): string {
  return formatNumber(locale, ms / 1000, {
    style: 'unit',
    unit: 'second',
    unitDisplay: SECOND_UNIT_DISPLAY[locale],
    maximumFractionDigits: 1,
  })
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(toBcp47(locale), options).format(value)
}
