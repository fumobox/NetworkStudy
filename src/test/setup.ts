import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** 実行環境にないときだけ補う（型定義上は常に存在するので、in で実在を確かめる） */
function polyfill(target: object, name: string, value: unknown): void {
  if (!(name in target)) {
    Object.defineProperty(target, name, { value, configurable: true, writable: true })
  }
}

// jsdom にない API のうち、Radix（Slider / Tooltip / Sheet など）が使うものを最小限に補う。
// `// @vitest-environment node` のテストでは window が存在しないのでスキップする
if (typeof window !== 'undefined') {
  polyfill(
    window,
    'ResizeObserver',
    class {
      observe() {
        // 何もしない
      }
      unobserve() {
        // 何もしない
      }
      disconnect() {
        // 何もしない
      }
    },
  )
  polyfill(Element.prototype, 'hasPointerCapture', () => false)
  polyfill(Element.prototype, 'setPointerCapture', () => undefined)
  polyfill(Element.prototype, 'releasePointerCapture', () => undefined)
  polyfill(Element.prototype, 'scrollIntoView', () => undefined)
}

afterEach(() => {
  // globals: false のため Testing Library の自動クリーンアップが働かない。明示的に呼ぶ
  cleanup()
  // jsdom の localStorage は同じファイル内のテスト間で共有されるため、毎回リセットする
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
  }
})
