import type { Locale } from '../locale'
import { en, type Messages } from './en'
import { ja } from './ja'

export type { Messages }

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, ja }

/** 各言語で表示する言語名（言語切替 UI では、どのロケールでも同じ表記を使う） */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  ja: '日本語',
}
