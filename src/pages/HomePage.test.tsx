import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { quizStorageKey } from '@/components/features/quiz/useQuizProgress'
import { THEME_QUIZZES } from '@/content/quizzes'
import { MESSAGES } from '@/lib/i18n'

const totalQuestions = THEME_QUIZZES.reduce((sum, theme) => sum + theme.quiz.questions.length, 0)

function renderHome(locale: 'en' | 'ja' = 'en') {
  return render(
    <MemoryRouter initialEntries={[`/${locale}`]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('HomePage の全体の進捗', () => {
  it('まだ何も解いていなければ 0', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 2, name: 'Your progress' })).toBeInTheDocument()
    expect(
      screen.getByText(
        MESSAGES.en.home.overall({
          finished: 0,
          themes: THEME_QUIZZES.length,
          correct: 0,
          questions: totalQuestions,
        }),
      ),
    ).toBeInTheDocument()
  })

  it('全問に答えたテーマと、正解の数を数える', () => {
    const [first, second] = THEME_QUIZZES
    if (first === undefined || second === undefined) throw new Error('no quizzes')
    // 1 つ目は全問正解、2 つ目は 1 問だけ回答して不正解
    localStorage.setItem(
      quizStorageKey(first.quiz.id),
      JSON.stringify({
        answers: Object.fromEntries(first.quiz.questions.map((q) => [q.id, q.answerId])),
      }),
    )
    const [q] = second.quiz.questions
    const wrong = q?.choices.find((choice) => choice.id !== q.answerId)
    if (q === undefined || wrong === undefined) throw new Error('no question')
    localStorage.setItem(
      quizStorageKey(second.quiz.id),
      JSON.stringify({ answers: { [q.id]: wrong.id } }),
    )
    renderHome('ja')
    expect(
      screen.getByText(
        MESSAGES.ja.home.overall({
          finished: 1,
          themes: THEME_QUIZZES.length,
          correct: first.quiz.questions.length,
          questions: totalQuestions,
        }),
      ),
    ).toBeInTheDocument()
  })
})
