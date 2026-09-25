// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Quiz } from './types'
import { collectQuizTexts, validateQuiz } from './validate'

const text = (en: string) => ({ en, ja: `${en}（ja）` })

const quiz: Quiz = {
  id: 'tcp',
  questions: [
    {
      id: 'q1',
      prompt: text('Which flag opens a connection?'),
      choices: [
        { id: 'syn', text: text('SYN') },
        { id: 'fin', text: text('FIN') },
      ],
      answerId: 'syn',
      explanation: text('SYN synchronizes sequence numbers.'),
    },
  ],
}

describe('validateQuiz', () => {
  it('整合したクイズでは問題なし', () => {
    expect(validateQuiz(quiz)).toEqual([])
  })

  it('問題がない・id の重複・選択肢の不足と重複・存在しない正解を検出する', () => {
    const [first] = quiz.questions
    if (first === undefined) throw new Error('fixture')
    const broken: Quiz = {
      id: '',
      questions: [
        first,
        { ...first, choices: [{ id: 'a', text: text('A') }], answerId: 'z' },
        {
          ...first,
          id: 'q3',
          choices: [
            { id: 'a', text: text('A') },
            { id: 'a', text: text('B') },
          ],
          answerId: 'a',
        },
      ],
    }
    expect(validateQuiz(broken).map((p) => p.message)).toEqual([
      'quiz id is empty',
      'question id "q1" is empty or duplicated',
      'question needs at least two choices',
      'answerId "z" is not one of the choices',
      'choice ids must be unique and non-empty',
    ])
    expect(validateQuiz({ id: 'x', questions: [] }).map((p) => p.message)).toEqual([
      'quiz has no questions',
    ])
  })

  it('空の翻訳と仮置きを検出する', () => {
    const [first] = quiz.questions
    if (first === undefined) throw new Error('fixture')
    const problems = validateQuiz({
      id: 'x',
      questions: [{ ...first, prompt: { en: 'TODO', ja: '' } }],
    })
    expect(problems).toEqual([
      { path: 'questions[0].prompt.en', message: 'text contains a placeholder' },
      { path: 'questions[0].prompt.ja', message: 'text is empty' },
    ])
  })
})

describe('collectQuizTexts', () => {
  it('問題文・解説・選択肢を集める', () => {
    expect(collectQuizTexts(quiz).map((entry) => entry.path)).toEqual([
      'questions[0].prompt',
      'questions[0].explanation',
      'questions[0].choices[0].text',
      'questions[0].choices[1].text',
    ])
  })
})
