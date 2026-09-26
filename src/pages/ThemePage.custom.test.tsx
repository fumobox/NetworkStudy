import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import type { CustomThemeModule } from '@/content/types'
import { waitForPage } from '@/test/waitForPage'

// custom テーマ（シーケンスエンジンを使わないテーマ）の表示を、テスト用のテーマで確かめる

// vi.mock は import より前に巻き上げられるので、テスト用のテーマは factory の中で作る（外の変数を参照しない）
vi.mock('@/content/registry', async () => {
  const { lazy } = await import('react')
  const customTheme: CustomThemeModule = {
    kind: 'custom',
    meta: {
      id: 'custom-fixture',
      kind: 'custom',
      category: 'basics',
      title: { en: 'Custom fixture', ja: 'カスタムのテーマ' },
      summary: { en: 'A theme with its own UI.', ja: '独自の UI を持つテーマ。' },
      difficulty: 'beginner',
      minutes: 5,
    },
    quiz: {
      id: 'custom-fixture',
      questions: [
        {
          id: 'q1',
          prompt: { en: 'Question?', ja: '質問？' },
          choices: [
            { id: 'a', text: { en: 'A', ja: 'A' } },
            { id: 'b', text: { en: 'B', ja: 'B' } },
          ],
          answerId: 'a',
          explanation: { en: 'Because.', ja: 'なぜなら。' },
        },
      ],
    },
    overview: {
      en: lazy(() => Promise.resolve({ default: () => <h2>Fixture overview</h2> })),
      ja: lazy(() => Promise.resolve({ default: () => <h2>概要</h2> })),
    },
    body: lazy(() => Promise.resolve({ default: () => <p>Fixture body</p> })),
  }
  return {
    THEMES: [customTheme],
    findTheme: (id: string | undefined) => (id === customTheme.meta.id ? customTheme : undefined),
  }
})

describe('ThemePage（custom テーマ）', () => {
  it('概要・本体・クイズを表示し、シーケンスのプレイヤーは表示しない', async () => {
    render(
      <MemoryRouter initialEntries={['/en/themes/custom-fixture']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    await waitForPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Custom fixture' })).toBeInTheDocument()
    expect(await screen.findByText('Fixture body')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Fixture overview' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Check your understanding' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Interactive walkthrough' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })
})
