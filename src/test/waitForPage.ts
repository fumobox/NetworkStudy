import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import { MESSAGES } from '@/lib/i18n/messages'

const LOADING_TEXTS = new Set(Object.values(MESSAGES).map((messages) => messages.theme.loading))

/** 遅延読み込みのページや概要（MDX）の「読み込み中…」が消えるまで待つ */
export async function waitForPage(): Promise<void> {
  // 初回はテスト環境での変換（MDX など）に時間がかかるので、既定の 1 秒より長く待つ
  await waitFor(
    () => {
      expect(screen.queryAllByText((text) => LOADING_TEXTS.has(text))).toEqual([])
    },
    { timeout: 5000 },
  )
}
