import { useState } from 'react'
import { z } from 'zod'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Quiz } from './types'

const progressSchema = z.object({
  answers: z.record(z.string(), z.string()),
})

export type QuizAnswers = Readonly<Record<string, string>>

export interface QuizScore {
  readonly correct: number
  readonly answered: number
  readonly total: number
}

export function quizStorageKey(quizId: string): string {
  return `ns.quiz.${quizId}`
}

/** 保存されていた回答のうち、今のクイズに存在する問題・選択肢のものだけを残す */
function sanitize(quiz: Quiz, answers: Readonly<Record<string, string>>): QuizAnswers {
  return Object.fromEntries(
    quiz.questions.flatMap((question) => {
      const answer = answers[question.id]
      return answer !== undefined && question.choices.some((choice) => choice.id === answer)
        ? [[question.id, answer]]
        : []
    }),
  )
}

/** 正解した回答だけを残す（間違えた問題を解き直すため） */
export function keepCorrect(quiz: Quiz, answers: QuizAnswers): QuizAnswers {
  return Object.fromEntries(
    quiz.questions.flatMap((question) =>
      answers[question.id] === question.answerId ? [[question.id, question.answerId]] : [],
    ),
  )
}

/** 間違えた問題（回答したが正解でないもの）の id */
export function incorrectQuestionIds(quiz: Quiz, answers: QuizAnswers): string[] {
  return quiz.questions
    .filter((question) => {
      const answer = answers[question.id]
      return answer !== undefined && answer !== question.answerId
    })
    .map((question) => question.id)
}

export function scoreQuiz(quiz: Quiz, answers: QuizAnswers): QuizScore {
  return {
    correct: quiz.questions.filter((question) => answers[question.id] === question.answerId).length,
    answered: quiz.questions.filter((question) => answers[question.id] !== undefined).length,
    total: quiz.questions.length,
  }
}

/** 保存されている回答を読む（今のクイズに合わない回答は捨てる） */
export function readQuizAnswers(quiz: Quiz): QuizAnswers {
  return sanitize(quiz, readStorage(quizStorageKey(quiz.id), progressSchema)?.answers ?? {})
}

/**
 * クイズの回答を localStorage に保存する（ロケールには依存しない）。
 * 1 ページに 1 つのインスタンスで使う前提で、他のインスタンスやタブとは同期しない。
 * quiz が変わったら呼び出し側で再マウントする（QuizPanel は key={quiz.id} で行っている）
 */
export function useQuizProgress(quiz: Quiz) {
  const [answers, setAnswers] = useState<QuizAnswers>(() => readQuizAnswers(quiz))

  const save = (next: QuizAnswers) => {
    setAnswers(next)
    writeStorage(quizStorageKey(quiz.id), { answers: next })
  }

  return {
    answers,
    score: scoreQuiz(quiz, answers),
    /** 回答する。回答済みの問題は変更しない（やり直すには reset） */
    answer: (questionId: string, choiceId: string) => {
      if (answers[questionId] === undefined) {
        save({ ...answers, [questionId]: choiceId })
      }
    },
    reset: () => {
      save({})
    },
    /** 間違えた問題の回答だけを消す。正解した問題の回答は残す */
    retryIncorrect: () => {
      save(keepCorrect(quiz, answers))
    },
  }
}
