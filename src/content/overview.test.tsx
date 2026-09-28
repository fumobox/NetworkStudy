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
      // MDX は h2 から書く（ページの h1 はテーマ名。ページでは「概要」の h2 の下に 1 段下げて表示する）
      expect(container.querySelector('h1, h2, h3, h4, h5, h6')?.tagName).toBe('H2')
      expect(container.querySelector('h1')).toBeNull()
      // 日本語で全角の記号の直後に ** を閉じると太字にならず、記号がそのまま表示される
      expect(container.textContent).not.toMatch(/\*\*|__/)
      // 閉じそこねた ** が次の ** と組になると、記号は残らずに太字が入れ子になる
      expect(container.querySelector('strong strong')).toBeNull()
    },
  )
})
