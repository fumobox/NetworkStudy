import type { LocalizedText } from '@/lib/i18n/locale'

export interface QuizChoice {
  readonly id: string
  readonly text: LocalizedText
}

export interface QuizQuestion {
  readonly id: string
  readonly prompt: LocalizedText
  readonly choices: readonly QuizChoice[]
  /** 正解の choice の id */
  readonly answerId: string
  /** 回答後に表示する解説 */
  readonly explanation: LocalizedText
}

export interface Quiz {
  /** 保存に使う id（テーマの id と同じにする） */
  readonly id: string
  readonly questions: readonly QuizQuestion[]
}
