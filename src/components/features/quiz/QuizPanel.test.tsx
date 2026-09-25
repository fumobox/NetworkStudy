import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { QuizPanel } from './QuizPanel'
import type { Quiz } from './types'
import { quizStorageKey, scoreQuiz } from './useQuizProgress'

const quiz: Quiz = {
  id: 'tcp-handshake',
  questions: [
    {
      id: 'q1',
      prompt: { en: 'Which flag opens a connection?', ja: '接続を開くフラグは？' },
      choices: [
        { id: 'syn', text: { en: 'SYN', ja: 'SYN' } },
        { id: 'fin', text: { en: 'FIN', ja: 'FIN' } },
      ],
      answerId: 'syn',
      explanation: {
        en: 'SYN synchronizes sequence numbers.',
        ja: 'SYN はシーケンス番号を同期する。',
      },
    },
    {
      id: 'q2',
      prompt: { en: 'What is the Ack of the SYN, ACK?', ja: 'SYN, ACK の Ack は？' },
      choices: [
        { id: 'iss', text: { en: 'Client ISS', ja: 'クライアントの ISS' } },
        { id: 'iss1', text: { en: 'Client ISS + 1', ja: 'クライアントの ISS + 1' } },
      ],
      answerId: 'iss1',
      explanation: { en: 'The SYN uses one number.', ja: 'SYN が番号を 1 つ消費する。' },
    },
  ],
}

function renderQuiz(locale: Locale = 'en') {
  return render(
    <LocaleProvider locale={locale}>
      <QuizPanel quiz={quiz} />
    </LocaleProvider>,
  )
}

describe('QuizPanel', () => {
  it('問題と選択肢を表示し、スコアは 0', () => {
    renderQuiz()
    expect(screen.getByRole('region', { name: 'Check your understanding' })).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /Which flag opens a connection\?/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('0 of 2 correct')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('正解すると「正解」と解説を読み上げ、スコアが増える', async () => {
    const user = userEvent.setup()
    renderQuiz()
    const q1 = screen.getByRole('group', { name: /Which flag/ })
    await user.click(within(q1).getByRole('button', { name: /^SYN/ }))
    expect(within(q1).getByRole('status')).toHaveTextContent('Correct!')
    expect(within(q1).getByRole('status')).toHaveTextContent('SYN synchronizes sequence numbers.')
    expect(screen.getByText('1 of 2 correct')).toBeInTheDocument()
  })

  it('不正解なら正解を示し、回答後は選び直せない', async () => {
    const user = userEvent.setup()
    renderQuiz()
    const q2 = screen.getByRole('group', { name: /Ack of the SYN, ACK/ })
    await user.click(within(q2).getByRole('button', { name: /^Client ISS$/ }))
    expect(within(q2).getByRole('status')).toHaveTextContent('Not quite.')
    expect(within(q2).getByRole('status')).toHaveTextContent('The answer is: Client ISS + 1')
    const chosen = within(q2).getByRole('button', { name: 'Client ISS — your answer' })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(chosen).toHaveAttribute('aria-disabled', 'true')
    const correct = within(q2).getByRole('button', { name: 'Client ISS + 1 — correct answer' })
    // 回答後は選び直せない
    await user.click(correct)
    expect(screen.getByText('0 of 2 correct')).toBeInTheDocument()
  })

  it('回答を保存し、再表示しても残る。「もう一度」でリセットする', async () => {
    const user = userEvent.setup()
    const { unmount } = renderQuiz()
    await user.click(screen.getByRole('button', { name: /^SYN/ }))
    expect(JSON.parse(window.localStorage.getItem(quizStorageKey(quiz.id)) ?? '{}')).toEqual({
      answers: { q1: 'syn' },
    })
    unmount()
    renderQuiz('ja')
    expect(screen.getByText('2 問中 1 問正解')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'もう一度' }))
    expect(screen.getByText('2 問中 0 問正解')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(quizStorageKey(quiz.id)) ?? '{}')).toEqual({
      answers: {},
    })
  })

  it('保存された回答のうち、今の問題・選択肢に合わないものは無視する', () => {
    window.localStorage.setItem(
      quizStorageKey(quiz.id),
      JSON.stringify({ answers: { q1: 'nope', gone: 'syn', q2: 'iss1' } }),
    )
    renderQuiz()
    expect(screen.getByText('1 of 2 correct')).toBeInTheDocument()
  })

  it('保存データが JSON として壊れていれば、回答なしから始める', () => {
    window.localStorage.setItem(quizStorageKey(quiz.id), '{broken')
    renderQuiz()
    expect(screen.getByText('0 of 2 correct')).toBeInTheDocument()
  })

  it('別のクイズに切り替わったら、そのクイズの回答を読み直す', async () => {
    const user = userEvent.setup()
    const other: Quiz = { ...quiz, id: 'dns-resolution', questions: quiz.questions.slice(0, 1) }
    const { rerender } = renderQuiz()
    await user.click(screen.getByRole('button', { name: /^SYN/ }))
    rerender(
      <LocaleProvider locale="en">
        <QuizPanel quiz={other} />
      </LocaleProvider>,
    )
    expect(screen.getByText('0 of 1 correct')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^FIN/ }))
    expect(
      JSON.parse(window.localStorage.getItem(quizStorageKey('dns-resolution')) ?? '{}'),
    ).toEqual({
      answers: { q1: 'fin' },
    })
    expect(JSON.parse(window.localStorage.getItem(quizStorageKey(quiz.id)) ?? '{}')).toEqual({
      answers: { q1: 'syn' },
    })
  })
})

describe('scoreQuiz', () => {
  it('正解数・回答数・問題数', () => {
    expect(scoreQuiz(quiz, { q1: 'syn', q2: 'iss' })).toEqual({ correct: 1, answered: 2, total: 2 })
    expect(scoreQuiz(quiz, {})).toEqual({ correct: 0, answered: 0, total: 2 })
  })
})
