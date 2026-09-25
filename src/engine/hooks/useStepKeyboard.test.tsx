import { fireEvent, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStepKeyboard } from './useStepKeyboard'

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Document | Element = document.body,
) {
  return fireEvent.keyDown(target, { key, ...init })
}

function Harness({ dispatch }: { dispatch: (action: unknown) => void }) {
  useStepKeyboard(dispatch)
  return (
    <>
      <button type="button">b</button>
      <a href="#x">link</a>
      <input aria-label="i" />
      <div role="slider" aria-valuenow={0} tabIndex={0} />
      <div role="dialog" aria-label="d">
        <span>in dialog</span>
      </div>
    </>
  )
}

describe('useStepKeyboard', () => {
  it('本文にフォーカスがあるとき、← / → / Space をアクションに対応付ける', () => {
    const dispatch = vi.fn()
    renderHook(() => {
      useStepKeyboard(dispatch)
    })
    press('ArrowRight')
    press('ArrowLeft')
    press(' ')
    press('a')
    expect(dispatch.mock.calls.map(([action]: unknown[]) => action)).toEqual([
      { type: 'next' },
      { type: 'prev' },
      { type: 'togglePlay' },
    ])
  })

  it('処理したキーは既定の動作（Space のスクロールなど）を止める', () => {
    renderHook(() => {
      useStepKeyboard(vi.fn())
    })
    expect(press(' ')).toBe(false)
    expect(press('a')).toBe(true)
  })

  it('修飾キー・IME 変換中・処理済み・長押しの Space は無視する', () => {
    const dispatch = vi.fn()
    renderHook(() => {
      useStepKeyboard(dispatch)
    })
    press('ArrowRight', { altKey: true })
    press('ArrowRight', { metaKey: true })
    press(' ', { shiftKey: true })
    press('ArrowRight', { isComposing: true })
    press(' ', { repeat: true })
    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ボタンやリンクの上では ← / → は効き、Space はその要素に任せる', () => {
    const dispatch = vi.fn()
    const { getByRole } = render(<Harness dispatch={dispatch} />)
    press('ArrowRight', {}, getByRole('button'))
    press('ArrowLeft', {}, getByRole('link'))
    press(' ', {}, getByRole('button'))
    press(' ', {}, getByRole('link'))
    expect(dispatch.mock.calls.map(([action]: unknown[]) => action)).toEqual([
      { type: 'next' },
      { type: 'prev' },
    ])
  })

  it('矢印キーを使う要素（入力欄・スライダー）やダイアログの中では何もしない', () => {
    const dispatch = vi.fn()
    const { getByRole, getByText } = render(<Harness dispatch={dispatch} />)
    press('ArrowRight', {}, getByRole('textbox'))
    press('ArrowRight', {}, getByRole('slider'))
    press('ArrowRight', {}, getByText('in dialog'))
    press(' ', {}, getByRole('textbox'))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('無効化・アンマウントで反応しなくなる', () => {
    const dispatch = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ enabled }) => {
        useStepKeyboard(dispatch, enabled)
      },
      { initialProps: { enabled: false } },
    )
    press('ArrowRight')
    expect(dispatch).not.toHaveBeenCalled()
    rerender({ enabled: true })
    press('ArrowRight')
    expect(dispatch).toHaveBeenCalledTimes(1)
    unmount()
    press('ArrowRight')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
