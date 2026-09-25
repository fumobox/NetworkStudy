import { useEffect } from 'react'
import type { PlayerAction } from '../player'

/** フォーカスがこれらの要素にあるときは、その要素自身のキー操作を優先する */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="tab"], [role="menuitem"], [role="option"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}

const KEY_ACTIONS: Readonly<Record<string, PlayerAction>> = {
  ArrowLeft: { type: 'prev' },
  ArrowRight: { type: 'next' },
  ' ': { type: 'togglePlay' },
}

/**
 * ← / → でステップを移動し、Space で再生・一時停止する。
 * 修飾キー付きのときや、フォーカスがボタン・入力欄などにあるときは何もしない。
 */
export function useStepKeyboard(dispatch: (action: PlayerAction) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isInteractiveTarget(event.target)
      ) {
        return
      }
      const action = KEY_ACTIONS[event.key]
      if (action === undefined) {
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
