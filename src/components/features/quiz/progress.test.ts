// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { summarizeQuizProgress } from './progress'
import type { QuizScore } from './useQuizProgress'

function scores(entries: Record<string, QuizScore>): Map<string, QuizScore> {
  return new Map(Object.entries(entries))
}

describe('summarizeQuizProgress', () => {
  it('テーマがなければ、すべて 0 で始まっていない', () => {
    expect(summarizeQuizProgress([], new Map())).toEqual({
      finished: 0,
      themes: 0,
      correct: 0,
      questions: 0,
      started: false,
      nextThemeId: null,
    })
  })

  it('1 問も答えていなければ始まっていない', () => {
    const summary = summarizeQuizProgress(
      ['a', 'b'],
      scores({
        a: { correct: 0, answered: 0, total: 3 },
        b: { correct: 0, answered: 0, total: 4 },
      }),
    )
    expect(summary).toMatchObject({ started: false, finished: 0, questions: 7, nextThemeId: 'a' })
  })

  it('一部だけ答えたテーマは答え終えていない。間違いがあっても全問答えれば答え終えた', () => {
    const summary = summarizeQuizProgress(
      ['a', 'b', 'c'],
      scores({
        a: { correct: 1, answered: 3, total: 3 },
        b: { correct: 2, answered: 2, total: 4 },
        c: { correct: 0, answered: 0, total: 4 },
      }),
    )
    expect(summary).toEqual({
      finished: 1,
      themes: 3,
      correct: 3,
      questions: 11,
      started: true,
      nextThemeId: 'b',
    })
  })

  it('得点のないテーマは、答え終えていないテーマとして数える', () => {
    const summary = summarizeQuizProgress(
      ['a', 'missing'],
      scores({ a: { correct: 3, answered: 3, total: 3 } }),
    )
    expect(summary).toMatchObject({ finished: 1, themes: 2, questions: 3, nextThemeId: 'missing' })
  })

  it('すべて答え終えていれば、次のテーマは null', () => {
    const summary = summarizeQuizProgress(
      ['a', 'b'],
      scores({
        a: { correct: 3, answered: 3, total: 3 },
        b: { correct: 4, answered: 4, total: 4 },
      }),
    )
    expect(summary).toMatchObject({ finished: 2, correct: 7, nextThemeId: null })
  })

  it('問題のないクイズは答え終えたものとして数えない', () => {
    const summary = summarizeQuizProgress(
      ['a'],
      scores({ a: { correct: 0, answered: 0, total: 0 } }),
    )
    expect(summary).toMatchObject({ finished: 0, started: false, nextThemeId: 'a' })
  })

  it('並びにないテーマの得点は数えない', () => {
    const summary = summarizeQuizProgress(
      ['a'],
      scores({
        a: { correct: 1, answered: 1, total: 3 },
        other: { correct: 5, answered: 5, total: 5 },
      }),
    )
    expect(summary).toMatchObject({ correct: 1, questions: 3, finished: 0 })
  })
})
