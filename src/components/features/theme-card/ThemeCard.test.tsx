import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { NAT_META, TCP_HANDSHAKE_META, type ThemeMeta } from '@/content/themeMeta'
import { LocaleProvider } from '@/lib/i18n'
import { ThemeCard } from './ThemeCard'

function renderCard(theme: ThemeMeta) {
  render(
    <MemoryRouter>
      <LocaleProvider locale="ja">
        <ThemeCard theme={theme} order={1} />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

describe('ThemeCard', () => {
  it('分類の色で縁取り、難易度はバッジの色と文字で示す', () => {
    renderCard(NAT_META)
    expect(screen.getByRole('article')).toHaveClass('border-tone-amber')
    const badge = screen.getByText('中級')
    expect(badge).toHaveAttribute('data-difficulty', 'intermediate')
    expect(badge).toHaveClass('bg-tone-violet-soft', 'text-tone-violet')
  })

  it('初級は緑のバッジ', () => {
    renderCard(TCP_HANDSHAKE_META)
    expect(screen.getByText('初級')).toHaveClass('bg-tone-green-soft')
  })
})

describe('ThemeCard の道筋のページでの表示', () => {
  it('見出しの階層を変えられ、道筋の id を ?path= で付ける', () => {
    render(
      <MemoryRouter>
        <LocaleProvider locale="en">
          <ThemeCard theme={NAT_META} headingLevel={3} pathId="infrastructure" />
        </LocaleProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(NAT_META.title.en)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/themes/nat?path=infrastructure')
  })

  it('既定は h4 で、クエリを付けない', () => {
    renderCard(NAT_META)
    expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ja/themes/nat')
  })
})
