import { DEFAULT_LOCALE, isLocale, type Locale } from './locale'

/** BCP 47 の言語タグ（`ja-JP` など）を対応ロケールに対応付ける。対応外なら null */
export function matchLocale(tag: string): Locale | null {
  const language = tag.toLowerCase().split('-')[0]
  return isLocale(language) ? language : null
}

interface DetectLocaleInput {
  /** 保存済みの設定（検証前の値） */
  stored: unknown
  /** ブラウザの言語設定（`navigator.languages`） */
  languages: readonly string[]
}

/** 表示するロケールを決める。保存済みの設定 → ブラウザの言語 → デフォルトの順 */
export function detectLocale({ stored, languages }: DetectLocaleInput): Locale {
  if (isLocale(stored)) {
    return stored
  }
  for (const tag of languages) {
    const matched = matchLocale(tag)
    if (matched !== null) {
      return matched
    }
  }
  return DEFAULT_LOCALE
}
