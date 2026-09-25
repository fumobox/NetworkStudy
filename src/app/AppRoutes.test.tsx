import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_STORAGE_KEY } from '@/lib/i18n'
import { AppRoutes } from './AppRoutes'

function LocationProbe() {
  const { pathname, search, hash } = useLocation()
  return <output data-testid="location">{pathname + search + hash}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function mockBrowserLanguages(languages: readonly string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
}

async function expectLocation(expected: string) {
  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(expected)
  })
}

beforeEach(() => {
  mockBrowserLanguages(['en-US', 'en'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ルートのリダイレクト', () => {
  it('ブラウザの言語が日本語なら / から /ja へ', async () => {
    mockBrowserLanguages(['ja-JP', 'en'])
    renderAt('/')
    await expectLocation('/ja')
    expect(screen.getByRole('heading', { level: 1, name: 'NetworkStudy' })).toBeInTheDocument()
    expect(screen.getByText(/1パケットずつ/)).toBeInTheDocument()
  })

  it('対応していない言語なら / から /en へ', async () => {
    mockBrowserLanguages(['fr-FR'])
    renderAt('/')
    await expectLocation('/en')
  })

  it('保存済みの設定をブラウザの言語より優先する', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('ja'))
    renderAt('/')
    await expectLocation('/ja')
  })

  it('ロケールのないパスには、クエリとハッシュを保ったままロケールを付ける', async () => {
    renderAt('/themes/tcp?step=3#detail')
    await expectLocation('/en/themes/tcp?step=3#detail')
  })

  it('URL が対応言語の地域付きタグなら、その言語にする', async () => {
    renderAt('/ja-JP/themes/tcp')
    await expectLocation('/ja/themes/tcp')
  })

  it('大文字のロケールは正規化する', async () => {
    renderAt('/EN/themes')
    await expectLocation('/en/themes')
  })

  it('先頭が二重スラッシュでも空白画面にならずリダイレクトする', async () => {
    renderAt('//en')
    await expectLocation('/en')
    expect(screen.getByRole('heading', { level: 1, name: 'NetworkStudy' })).toBeInTheDocument()
  })

  it('対応外のロケールは差し替える', async () => {
    mockBrowserLanguages(['ja'])
    renderAt('/fr/themes/tcp?step=1')
    await expectLocation('/ja/themes/tcp?step=1')
  })
})

describe('GitHub Pages の basename 配下', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('404.html から起動したロケールなしのパスを、basename を保ったままリダイレクトする', async () => {
    window.history.replaceState(null, '', '/NetworkStudy/themes/tcp?step=1#h')
    render(
      <BrowserRouter basename="/NetworkStudy/">
        <AppRoutes />
        <LocationProbe />
      </BrowserRouter>,
    )
    await expectLocation('/en/themes/tcp?step=1#h')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/NetworkStudy/en/themes/tcp?step=1#h',
    )
  })
})

describe('LocaleLayout', () => {
  it('末尾スラッシュ付きの /en/ でもホームを表示する', () => {
    renderAt('/en/')
    expect(screen.getByRole('heading', { level: 1, name: 'NetworkStudy' })).toBeInTheDocument()
  })

  it('ページごとの <title> を設定する', async () => {
    renderAt('/ja/no-such-page')
    await waitFor(() => {
      expect(document.title).toBe('ページが見つかりません | NetworkStudy')
    })
    expect(document.head.querySelectorAll('meta[name="robots"][content="noindex"]')).toHaveLength(1)
  })

  it('<html lang> をロケールに合わせる', async () => {
    renderAt('/ja')
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ja')
    })
  })

  it('存在しないページでは NotFound をそのロケールで表示する', () => {
    renderAt('/ja/no-such-page')
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ホームへ戻る' })).toHaveAttribute('href', '/ja')
  })
})

describe('LanguageSwitcher', () => {
  it('現在のロケールに aria-current を付ける', () => {
    renderAt('/en')
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '日本語' })).not.toHaveAttribute('aria-current')
  })

  it('切り替えるとパスのロケールだけを差し替え、クエリとハッシュを保ち、設定を保存する', async () => {
    const user = userEvent.setup()
    renderAt('/en/no-such-page?step=2#x')
    await user.click(screen.getByRole('link', { name: '日本語' }))

    await expectLocation('/ja/no-such-page?step=2#x')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(JSON.stringify('ja'))
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
  })
})
