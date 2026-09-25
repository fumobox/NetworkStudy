import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// globals: false のため Testing Library の自動クリーンアップが働かない。明示的に登録する
afterEach(() => {
  cleanup()
})
