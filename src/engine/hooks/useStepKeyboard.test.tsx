import { fireEvent, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStepKeyboard } from './useStepKeyboard'

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Document | Element = document.body,
) {
  fireEvent.keyDown(target, { key, ...init })
}

describe('useStepKeyboard', () => {
  it('← / → / Space をアクションに対応付ける', () => {
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

  it('修飾キー付きのときは何もしない', () => {
    const dispatch = vi.fn()
    renderHook(() => {
      useStepKeyboard(dispatch)
    })
    press('ArrowRight', { altKey: true })
    press('ArrowRight', { metaKey: true })
    press(' ', { shiftKey: true })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ボタン・入力欄・スライダーにフォーカスがあるときは、その要素の操作を優先する', () => {
    const dispatch = vi.fn()
    function Harness() {
      useStepKeyboard(dispatch)
      return (
        <>
          <button type="button">b</button>
          <input aria-label="i" />
          <div role="slider" aria-valuenow={0} tabIndex={0} />
          <p>text</p>
        </>
      )
    }
    const { getByRole, getByText } = render(<Harness />)
    press(' ', {}, getByRole('button'))
    press('ArrowRight', {}, getByRole('textbox'))
    press('ArrowRight', {}, getByRole('slider'))
    expect(dispatch).not.toHaveBeenCalled()
    press('ArrowRight', {}, getByText('text'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'next' })
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
