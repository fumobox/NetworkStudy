import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
        <LoadErrorBoundary resetKey="/ja/themes/route-lookup" onReload={onReload}>
          <Broken />
        </LoadErrorBoundary>
      </LocaleProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('このページを読み込めませんでした')
    await userEvent.click(screen.getByRole('button', { name: 'ページを読み込み直す' }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('resetKey が変わったら、子をまた出す', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = (resetKey: string, broken: boolean) => (
      <LocaleProvider locale="en">
        <LoadErrorBoundary resetKey={resetKey}>
          {broken ? <Broken /> : <p>icmp</p>}
        </LoadErrorBoundary>
      </LocaleProvider>
    )
    const { rerender } = render(view('/en/themes/route-lookup', true))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(view('/en/themes/icmp', false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('icmp')).toBeInTheDocument()
  })

  it('resetKey が変わっても、問題のない子はマウントし直さない（状態を保つ）', async () => {
    function Counter() {
      const [count, setCount] = useState(0)
      return (
        <button
          type="button"
          onClick={() => {
            setCount((value) => value + 1)
          }}
        >
          {String(count)}
        </button>
      )
    }
    const view = (resetKey: string) => (
      <LocaleProvider locale="en">
        <LoadErrorBoundary resetKey={resetKey}>
          <Counter />
        </LoadErrorBoundary>
      </LocaleProvider>
    )
    const { rerender } = render(view('/en/themes/route-lookup'))
    await userEvent.click(screen.getByRole('button'))
    rerender(view('/ja/themes/route-lookup'))
    expect(screen.getByRole('button')).toHaveTextContent('1')
  })
})
