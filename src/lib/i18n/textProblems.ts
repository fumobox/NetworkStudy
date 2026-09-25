import { LOCALES, type LocalizedText } from './locale'

export interface LocalizedTextEntry {
  readonly path: string
  readonly text: LocalizedText
}

export interface TextProblem {
  readonly path: string
  readonly message: string
}

const PLACEHOLDER = /\bTODO\b|\bFIXME\b/

/** 翻訳の空欄と仮置き（TODO / FIXME）を、全ロケールについて検出する */
export function findTextProblems(entries: readonly LocalizedTextEntry[]): TextProblem[] {
  return entries.flatMap(({ path, text }) =>
    LOCALES.flatMap((locale) => {
      const value = text[locale].trim()
      if (value === '') {
        return [{ path: `${path}.${locale}`, message: 'text is empty' }]
      }
      if (PLACEHOLDER.test(value)) {
        return [{ path: `${path}.${locale}`, message: 'text contains a placeholder' }]
      }
      return []
    }),
  )
}
