import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { THEME_IDS } from '@/content/themeMeta'
import { LOCALES, MESSAGES, type Locale } from '@/lib/i18n'
import { AppRoutes } from './AppRoutes'

/** 辞書の文字列のうち、ロケールによって訳が異なるもの（関数の文言は除く） */
function translatedStrings(node: unknown, other: unknown): [string, string][] {
  if (typeof node === 'string' && typeof other === 'string') {
    return node === other ? [] : [[node, other]]
  }
  if (typeof node === 'object' && node !== null && typeof other === 'object' && other !== null) {
    const otherEntries = new Map(Object.entries(other))
    return Object.entries(node).flatMap(([key, value]) =>
      translatedStrings(value, otherEntries.get(key)),
    )
  }
  return []
}

const ROUTES = ['', '/no-such-page', ...THEME_IDS.map((id) => `/themes/${id}`)]

/** 画面に出る文言（テキストと、aria-label・alt などの属性） */
function visibleTexts(root: HTMLElement): string[] {
  const attributes = [
    ...root.querySelectorAll('[aria-label], [alt], [placeholder], [title]'),
  ].flatMap((element) =>
    ['aria-label', 'alt', 'placeholder', 'title'].flatMap((name) => {
      const value = element.getAttribute(name)
      return value === null ? [] : [value]
    }),
  )
  return [...textNodes(root), ...attributes]
}

function textNodes(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? ''
    if (text !== '') {
      texts.push(text)
    }
  }
  return texts
}

function otherLocale(locale: Locale): Locale {
  return LOCALES.find((candidate) => candidate !== locale) ?? locale
}

describe('各ページを各ロケールで表示する', () => {
  it.each(LOCALES.flatMap((locale) => ROUTES.map((route) => [locale, route] as const)))(
    '%s%s に、他のロケールの UI 文言が混ざらない',
    (locale, route) => {
      const { container } = render(
        <MemoryRouter initialEntries={[`/${locale}${route}`]}>
          <AppRoutes />
        </MemoryRouter>,
      )
      const texts = visibleTexts(container)
      expect(texts.length).toBeGreaterThan(0)
      const foreign = new Set(
        translatedStrings(MESSAGES[otherLocale(locale)], MESSAGES[locale]).map(([text]) => text),
      )
      const leaked = texts.filter((text) => foreign.has(text))
      expect(leaked).toEqual([])
    },
  )
})
