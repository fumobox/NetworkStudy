import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { findLearningPath, type LearningPath } from '@/content/learningPaths'
import { THEME_META } from '@/content/themeMeta'
import { MESSAGES } from '@/lib/i18n'
import { waitForPage } from '@/test/waitForPage'

const m = MESSAGES.en

function path(id: string): LearningPath {
  const found = findLearningPath(id)
  if (found === undefined) throw new Error(`no path ${id}`)
  return found
}
const WEB = path('web-developer')
const INFRA = path('infrastructure')
const titleOf = (id: string) => THEME_META.find((meta) => meta.id === id)?.title.en ?? id

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

async function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
      <Location />
    </MemoryRouter>,
  )
  await waitForPage()
}

const navOf = (pathTitle: string) =>
  screen.getByRole('navigation', { name: m.pathNav.label({ path: pathTitle }) })

describe('テーマのページの学習の道筋', () => {
  it('?path= の道筋の位置と、前後のテーマ（?path= 付き）を出す', async () => {
    await renderAt('/en/themes/cors?path=web-developer')
    const nav = navOf(WEB.title.en)
    const index = WEB.themeIds.indexOf('cors')
    const position = m.pathNav.position({ current: index + 1, total: WEB.themeIds.length })
    expect(within(nav).getByText(position)).toBeInTheDocument()
    expect(
      within(nav).getByRole('link', { name: `${m.pathNav.previous} ${titleOf('http-caching')}` }),
    ).toHaveAttribute('href', '/en/themes/http-caching?path=web-developer')
    expect(
      within(nav).getByRole('link', { name: `${m.pathNav.next} ${titleOf('csrf')}` }),
    ).toHaveAttribute('href', '/en/themes/csrf?path=web-developer')
    // 見出しの下にも、道筋の名前（道筋のページへのリンク）と位置を出す
    expect(screen.getByRole('link', { name: WEB.title.en })).toHaveAttribute(
      'href',
      '/en/paths/web-developer',
    )
    expect(screen.getAllByText(position)).toHaveLength(2)
    // 一覧では今のテーマに aria-current
    expect(within(nav).getByRole('link', { name: titleOf('cors') })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('最初のテーマには前がない', async () => {
    await renderAt('/en/themes/osi-model?path=web-developer')
    const nav = navOf(WEB.title.en)
    expect(within(nav).queryByText(m.pathNav.previous)).toBeNull()
    expect(
      within(nav).getByRole('link', {
        name: `${m.pathNav.next} ${titleOf(WEB.themeIds[1] ?? '')}`,
      }),
    ).toBeInTheDocument()
  })

  it('?path= がなくても、テーマを含む道筋が 1 つならその道筋を出す', async () => {
    await renderAt('/en/themes/csrf')
    expect(navOf(WEB.title.en)).toBeInTheDocument()
    const position = m.pathNav.position({
      current: WEB.themeIds.indexOf('csrf') + 1,
      total: WEB.themeIds.length,
    })
    // 見出しの下と、ナビゲーションの中
    expect(screen.getAllByText(position)).toHaveLength(2)
  })

  it('最後のテーマ', async () => {
    await renderAt('/en/themes/reverse-proxy?path=web-developer')
    const nav = navOf(WEB.title.en)
    expect(within(nav).getByText(m.pathNav.finished)).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: m.pathNav.backToPath })).toHaveAttribute(
      'href',
      '/en/paths/web-developer',
    )
  })

  it('複数の道筋にあるテーマでも、?path= の道筋だけを出す', async () => {
    await renderAt('/en/themes/dns-resolution?path=infrastructure')
    expect(navOf(INFRA.title.en)).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: m.pathNav.label({ path: WEB.title.en }) }),
    ).toBeNull()
  })

  it('?path= がないか、テーマを含まない道筋なら、テーマを含む道筋から決める', async () => {
    await renderAt('/en/themes/csrf?path=infrastructure')
    expect(navOf(WEB.title.en)).toBeInTheDocument()
  })

  it('知らない ?path= も無視する', async () => {
    await renderAt('/en/themes/csrf?path=bogus')
    expect(navOf(WEB.title.en)).toBeInTheDocument()
  })

  it('?path= がなく複数の道筋にあるテーマでは、すべての道筋を並べる', async () => {
    await renderAt('/en/themes/dns-resolution')
    const nav = screen.getByRole('navigation', { name: m.pathNav.inPathsTitle })
    expect(within(nav).getByRole('link', { name: WEB.title.en })).toHaveAttribute(
      'href',
      '/en/paths/web-developer',
    )
    expect(within(nav).getByRole('link', { name: INFRA.title.en })).toBeInTheDocument()
    // 次のテーマはどちらの道筋でも同じだが、リンクはそれぞれの道筋を ?path= で引き継ぐ
    expect(
      within(nav)
        .getAllByRole('link', { name: m.pathNav.nextTo({ title: titleOf('tcp-handshake') }) })
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/en/themes/tcp-handshake?path=web-developer',
      '/en/themes/tcp-handshake?path=infrastructure',
    ])
  })

  it('どの道筋にもないテーマでは出さない', async () => {
    await renderAt('/en/themes/tcp-sack')
    expect(screen.queryByRole('navigation', { name: m.pathNav.inPathsTitle })).toBeNull()
    expect(screen.queryByRole('navigation', { name: /^Learning path: / })).toBeNull()
    expect(screen.queryByText(/^Theme \d+ of \d+$/)).toBeNull()
  })

  it('ステップを進めても ?path= は残り、ステップの表示と紛れない', async () => {
    const user = userEvent.setup()
    await renderAt('/en/themes/tcp-handshake?path=web-developer')
    expect(screen.getAllByText(/^Step \d+ of \d+$/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: m.stepper.next }))
    expect(screen.getByTestId('location')).toHaveTextContent(/path=web-developer/)
    expect(screen.getByTestId('location')).toHaveTextContent(/step=2/)
  })
})
