import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { quizStorageKey } from '@/components/features/quiz/useQuizProgress'
import { findLearningPath, type LearningPath } from '@/content/learningPaths'
import { THEME_QUIZZES } from '@/content/quizzes'
import { THEME_META } from '@/content/themeMeta'
import { MESSAGES } from '@/lib/i18n'

function path(id: string): LearningPath {
  const found = findLearningPath(id)
  if (found === undefined) throw new Error(`no path ${id}`)
  return found
}
const WEB = path('web-developer')
const titleOf = (id: string, locale: 'en' | 'ja' = 'en') =>
  THEME_META.find((meta) => meta.id === id)?.title[locale] ?? id

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

/** テーマのクイズに全問答えた記録を保存する */
function finish(themeId: string) {
  const theme = THEME_QUIZZES.find((candidate) => candidate.meta.id === themeId)
  if (theme === undefined) throw new Error(`no theme ${themeId}`)
  const answers = Object.fromEntries(theme.quiz.questions.map((q) => [q.id, q.answerId]))
  localStorage.setItem(quizStorageKey(theme.quiz.id), JSON.stringify({ answers }))
}

describe('PathPage', () => {
  it('道筋の名前、説明、タイトル、順番付きのテーマの一覧（?path= 付き）', async () => {
    renderAt('/en/paths/web-developer')
    expect(await screen.findByRole('heading', { level: 1, name: WEB.title.en })).toBeInTheDocument()
    expect(screen.getByText(WEB.summary.en)).toBeInTheDocument()
    expect(document.title).toBe(
      MESSAGES.en.common.pageTitle({
        page: MESSAGES.en.paths.pageTitle({ path: WEB.title.en }),
        site: 'NetworkStudy',
      }),
    )
    const list = screen.getByRole('region', { name: MESSAGES.en.paths.themesTitle })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(WEB.themeIds.map((id) => titleOf(id)))
    expect(links[0]).toHaveAttribute(
      'href',
      `/en/themes/${WEB.themeIds[0] ?? ''}?path=web-developer`,
    )
    // 道筋のページは h1 > h2 > h3（テーマの名前）
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(WEB.themeIds.length)
  })

  it('初めは進捗を出さず、最初のテーマから始めるボタンを出す', async () => {
    renderAt('/en/paths/web-developer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: MESSAGES.en.paths.progressTitle })).toBeNull()
    expect(screen.getByRole('link', { name: MESSAGES.en.paths.start })).toHaveAttribute(
      'href',
      `/en/themes/${WEB.themeIds[0] ?? ''}?path=web-developer`,
    )
  })

  it('答えたら進捗と、最初の終えていないテーマへの「続きから」を出す', async () => {
    const [first, second] = WEB.themeIds
    if (first === undefined || second === undefined) throw new Error('short path')
    finish(first)
    renderAt('/ja/paths/web-developer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('region', { name: MESSAGES.ja.paths.progressTitle })).toHaveTextContent(
      `${String(WEB.themeIds.length)} テーマ中 1 テーマ`,
    )
    expect(
      screen.getByRole('link', {
        name: MESSAGES.ja.paths.continue({ title: titleOf(second, 'ja') }),
      }),
    ).toHaveAttribute('href', `/ja/themes/${second}?path=web-developer`)
  })

  it('すべて終えたら、続きのボタンは出さない', async () => {
    for (const id of WEB.themeIds) finish(id)
    renderAt('/en/paths/web-developer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: MESSAGES.en.paths.start })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Continue with/ })).toBeNull()
  })

  it('知らない道筋は 404', async () => {
    renderAt('/en/paths/no-such-path')
    expect(
      await screen.findByRole('heading', { level: 1, name: MESSAGES.en.notFound.title }),
    ).toBeInTheDocument()
  })
})

describe('ホームの学習の道筋', () => {
  it('道筋のカードは「どこから始めるか」の外にあり、道筋のページへリンクする', async () => {
    renderAt('/en')
    const region = await screen.findByRole('region', { name: MESSAGES.en.paths.title })
    const links = within(region).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Web developers',
      'Infrastructure and operations',
    ])
    expect(links[0]).toHaveAttribute('href', '/en/paths/web-developer')
    const order = screen.getByRole('region', { name: MESSAGES.en.home.orderTitle })
    expect(within(order).queryByRole('link', { name: 'Web developers' })).toBeNull()
  })

  it('答えたテーマを含む道筋のカードにだけ、進捗を出す', async () => {
    finish('csrf')
    renderAt('/en')
    const region = await screen.findByRole('region', { name: MESSAGES.en.paths.title })
    const progress = MESSAGES.en.paths.progress({ finished: 1, themes: WEB.themeIds.length })
    expect(within(region).getByText(progress)).toBeInTheDocument()
    expect(within(region).getAllByText(/^Quizzes completed in/)).toHaveLength(1)
  })
})
