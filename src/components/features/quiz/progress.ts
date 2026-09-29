import type { Quiz } from './types'
import { readQuizAnswers, scoreQuiz, type QuizScore } from './useQuizProgress'

export interface QuizProgressSummary {
  /** クイズをすべて答え終えたテーマの数（正解かどうかは問わない） */
  readonly finished: number
  /** テーマの数（得点のないテーマは、答え終えていないものとして数える） */
  readonly themes: number
  readonly correct: number
  readonly questions: number
  /** 1 問でも答えたか（初めての訪問では「0 / N」を出さないため） */
  readonly started: boolean
  /** 並びの中で最初の、答え終えていないテーマ。すべて答え終えていれば null */
  readonly nextThemeId: string | null
}

function isFinished(score: QuizScore | undefined): boolean {
  return score !== undefined && score.total > 0 && score.answered === score.total
}

/** テーマの並び（ホームなら全テーマ、道筋のページならその道筋）について、クイズの進捗をまとめる */
export function summarizeQuizProgress(
  themeIds: readonly string[],
  scores: ReadonlyMap<string, QuizScore>,
): QuizProgressSummary {
  const listed = themeIds.map((id) => scores.get(id))
  const present = listed.filter((score) => score !== undefined)
  return {
    finished: listed.filter(isFinished).length,
    themes: themeIds.length,
    correct: present.reduce((sum, score) => sum + score.correct, 0),
    questions: present.reduce((sum, score) => sum + score.total, 0),
    started: present.some((score) => score.answered > 0),
    nextThemeId: themeIds.find((id) => !isFinished(scores.get(id))) ?? null,
  }
}

interface ThemeQuiz {
  readonly meta: { readonly id: string }
  readonly quiz: Quiz
}

/**
 * 保存されている回答から、テーマごとの得点を読む（表示のたびに localStorage を読む。
 * 他のタブの回答は、ページを開き直すまで反映しない）
 */
export function readQuizScores(themes: readonly ThemeQuiz[]): Map<string, QuizScore> {
  return new Map(
    themes.map((theme) => [theme.meta.id, scoreQuiz(theme.quiz, readQuizAnswers(theme.quiz))]),
  )
}
