import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '@/lib/i18n/locale'
import { THEMES } from './registry'

const cases = THEMES.flatMap((theme) =>
  LOCALES.map((locale) => [theme.meta.id, locale, theme] as const),
)

describe('テーマの概要（MDX）', () => {
  it.each(cases)(
    '%s（%s）は h2 から始まり、Markdown の記号がそのまま残っていない',
    async (_, locale, theme) => {
      const Overview = theme.overview[locale]
      const { container } = render(
        <Suspense fallback={null}>
          <Overview />
        </Suspense>,
      )
      await screen.findAllByRole('heading', { level: 2 })
      // ページの h1 はテーマ名なので、概要の見出しは h2 から始める
      expect(container.querySelector('h1, h2, h3, h4, h5, h6')?.tagName).toBe('H2')
      expect(container.querySelector('h1')).toBeNull()
      // 日本語で全角の記号の直後に ** を閉じると太字にならず、記号がそのまま表示される
      expect(container.textContent).not.toMatch(/\*\*|__/)
    },
  )
})
