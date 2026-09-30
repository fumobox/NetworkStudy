import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '@/lib/i18n/locale'
import { THEMES } from './registry'
import { THEME_IDS } from './themeMeta'

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

  it.each(THEMES.map((theme) => [theme.meta.id, theme] as const))(
    '%s の en と ja は、h2 の数、決まった節の位置、リンク先のテーマが同じ',
    async (_, theme) => {
      const outline = async (locale: (typeof LOCALES)[number]) => {
        const Overview = theme.overview[locale]
        const { container, unmount } = render(
          <Suspense fallback={null}>
            <Overview />
          </Suspense>,
        )
        const headings = await screen.findAllByRole('heading', { level: 2 })
        const links = [...container.querySelectorAll('a[href^="/themes/"]')].map((a) =>
          (a.getAttribute('href') ?? '').replace('/themes/', ''),
        )
        const texts = headings.map((h) => h.textContent)
        unmount()
        return { texts, links: [...new Set(links)].sort() }
      }
      const enOutline = await outline('en')
      const jaOutline = await outline('ja')
      expect(jaOutline.texts.length).toBe(enOutline.texts.length)
      const pairs: readonly (readonly [string, string])[] = [
        ['Try it yourself', '手元で試す'],
        ['About this page', 'このページについて'],
        ['References', '参考'],
      ]
      for (const [enText, jaText] of pairs) {
        expect(jaOutline.texts.indexOf(jaText), enText).toBe(enOutline.texts.indexOf(enText))
      }
      expect(enOutline.texts).toContain('Try it yourself')
      expect(enOutline.texts.at(-1)).toBe('References')
      expect(jaOutline.links).toEqual(enOutline.links)
      for (const id of enOutline.links) {
        expect(THEME_IDS).toContain(id)
      }
    },
  )
})
