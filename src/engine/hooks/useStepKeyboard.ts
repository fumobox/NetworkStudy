import { useEffect } from 'react'
import type { PlayerAction } from '../player'

/** 矢印キーを自分で使う要素。ここにフォーカスがあるときは ← / → を横取りしない */
const ARROW_KEY_CONSUMERS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="tab"], [role="radio"], [role="option"], [role="menuitem"], [role="combobox"], [role="listbox"], [role="spinbutton"], [role="textbox"], [role="dialog"], [aria-modal="true"]'

function matches(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null
}

/**
 * Space はボタンやリンクなどの操作にも使うので、フォーカスが本文（body）にあるときだけ再生・一時停止にする。
 * ボタンをクリックした直後もフォーカスはボタンに残るため、← / → はボタンやリンクの上でも有効にする
 */
function actionFor(event: KeyboardEvent): PlayerAction | null {
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      if (matches(event.target, ARROW_KEY_CONSUMERS)) {
        return null
      }
      return event.key === 'ArrowLeft' ? { type: 'prev' } : { type: 'next' }
    case ' ': {
      const onBody = event.target === document.body || event.target === document.documentElement
      return onBody && !event.repeat ? { type: 'togglePlay' } : null
    }
    default:
      return null
  }
}

/**
 * ← / → でステップを移動し、Space で再生・一時停止する（ページのスクロールは止める）。
 * 修飾キー付き・IME 変換中・他の要素が処理済みのときは何もしない。
 */
export function useStepKeyboard(dispatch: (action: PlayerAction) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }
      const action = actionFor(event)
      if (action === null) {
        return
      }
      event.preventDefault()
      dispatch(action)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dispatch, enabled])
}
