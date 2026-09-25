import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'

/** ブラウザの「戻る」を再現するボタン */
function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      data-testid="back"
      onClick={() => {
        void navigate(-1)
      }}
    />
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <BackButton />
    </MemoryRouter>,
  )
}

function stubSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark')
})

describe('配色の切り替え', () => {
  it('system → light → dark と切り替え、<html> の .dark と保存を更新する', async () => {
    stubSystemDark(true)
    const user = userEvent.setup()
    renderAt('/en')
    // system かつ OS がダーク
    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark')
    })
    const button = screen.getByRole('button', { name: /^Color theme: System/ })
    await user.click(button)
    expect(
      screen.getByRole('button', { name: 'Color theme: Light. Switch to Dark' }),
    ).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe(JSON.stringify('light'))
    await user.click(screen.getByRole('button', { name: /^Color theme: Light/ }))
    expect(document.documentElement).toHaveClass('dark')
  })

  it('保存した設定で始まる（日本語）', () => {
    stubSystemDark(false)
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, JSON.stringify('dark'))
    renderAt('/ja')
    expect(
      screen.getByRole('button', { name: '配色: ダーク。「システムに従う」に切り替える' }),
    ).toBeInTheDocument()
  })
})

describe('スマホのメニュー', () => {
  it('メニューからテーマ一覧を開き、テーマを選ぶと閉じる。戻っても開き直さない', async () => {
    const user = userEvent.setup()
    renderAt('/ja')
    await user.click(screen.getByRole('button', { name: 'メニュー' }))
    const dialog = await screen.findByRole('dialog', { name: 'メニュー' })
    expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('link', { name: 'DNS の名前解決' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('back'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'NetworkStudy' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('今いるページのリンクを押しても閉じる', async () => {
    const user = userEvent.setup()
    renderAt('/ja/themes/dns-resolution')
    await user.click(screen.getByRole('button', { name: 'メニュー' }))
    const dialog = await screen.findByRole('dialog', { name: 'メニュー' })
    await user.click(within(dialog).getByRole('link', { name: 'DNS の名前解決' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
