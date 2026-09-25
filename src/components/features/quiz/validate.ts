import type { LocalizedText } from '@/lib/i18n/locale'
import { findTextProblems } from '@/lib/i18n/textProblems'
import type { Quiz } from './types'

export interface QuizProblem {
  readonly path: string
  readonly message: string
}

export interface QuizTextEntry {
  readonly path: string
  readonly text: LocalizedText
}

/** クイズに含まれるすべての LocalizedText を集める（翻訳の網羅テストでも使う） */
export function collectQuizTexts(quiz: Quiz): QuizTextEntry[] {
  return quiz.questions.flatMap((question, i) => [
    { path: `questions[${String(i)}].prompt`, text: question.prompt },
    { path: `questions[${String(i)}].explanation`, text: question.explanation },
    ...question.choices.map((choice, j) => ({
      path: `questions[${String(i)}].choices[${String(j)}].text`,
      text: choice.text,
    })),
  ])
}

/** クイズの整合性（id の一意性、正解が選択肢にあること、翻訳の空欄）を検査する。問題がなければ [] */
export function validateQuiz(quiz: Quiz): readonly QuizProblem[] {
  const problems: QuizProblem[] = []
  if (quiz.id === '') {
    problems.push({ path: 'id', message: 'quiz id is empty' })
  }
  if (quiz.questions.length === 0) {
    problems.push({ path: 'questions', message: 'quiz has no questions' })
  }
  const questionIds = new Set<string>()
  quiz.questions.forEach((question, i) => {
    const path = `questions[${String(i)}]`
    if (question.id === '' || questionIds.has(question.id)) {
      problems.push({ path, message: `question id "${question.id}" is empty or duplicated` })
    }
    questionIds.add(question.id)
    if (question.choices.length < 2) {
      problems.push({ path, message: 'question needs at least two choices' })
    }
    const choiceIds = question.choices.map((choice) => choice.id)
    if (new Set(choiceIds).size !== choiceIds.length || choiceIds.includes('')) {
      problems.push({ path, message: 'choice ids must be unique and non-empty' })
    }
    if (!choiceIds.includes(question.answerId)) {
      problems.push({ path, message: `answerId "${question.answerId}" is not one of the choices` })
    }
  })
  problems.push(...findTextProblems(collectQuizTexts(quiz)))
  return problems
}
