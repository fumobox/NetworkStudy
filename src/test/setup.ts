import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  // globals: false のため Testing Library の自動クリーンアップが働かない。明示的に呼ぶ
  cleanup()
  // jsdom の localStorage は同じファイル内のテスト間で共有されるため、毎回リセットする。
  // `// @vitest-environment node` のテストでは window が存在しないのでスキップする
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
  }
})
