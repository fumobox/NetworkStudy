import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import { LoadErrorBoundary } from './LoadErrorBoundary'

function Broken(): never {
  throw new TypeError('Failed to fetch dynamically imported module')
}

describe('LoadErrorBoundary', () => {
  it('子が投げたら、読み込み直しを促すメッセージとボタンを出す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onReload = vi.fn()
    render(
      <LocaleProvider locale="ja">
        <LoadErrorBoundary onReload={onReload}>
          <Broken />
        </LoadErrorBoundary>
      </LocaleProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('このページを読み込めませんでした')
    await userEvent.click(screen.getByRole('button', { name: 'ページを読み込み直す' }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('問題がなければ子をそのまま出す', () => {
    render(
      <LocaleProvider locale="en">
        <LoadErrorBoundary>
          <p>content</p>
        </LoadErrorBoundary>
      </LocaleProvider>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
