import type { DeepReadonly } from '@/types/utility'

/**
 * UI 文言の辞書（英語）。この辞書を正とし、型 `Messages` はここから導出する。
 * 値は文字列、または引数に型を付けた関数で持つ。
 * `as const` を付けると値がリテラル型になり他言語の辞書が代入できなくなるため、付けない。
 * 代わりに `Messages` を DeepReadonly にして、辞書の書き換えを型で禁止する。
 */
export const en = {
  common: {
    siteName: 'NetworkStudy',
    tagline: 'Learn how network protocols work, one packet at a time.',
    pageTitle: (p: { page: string }) => `${p.page} | NetworkStudy`,
  },
  nav: {
    home: 'Home',
    themes: 'Themes',
  },
  language: {
    label: 'Language',
  },
  layout: {
    skipToContent: 'Skip to content',
  },
  footer: {
    license: 'MIT License',
    source: 'Source code',
  },
  stepper: {
    counter: (p: { current: number; total: number }) =>
      `Step ${String(p.current)} of ${String(p.total)}`,
    prev: 'Back',
    next: 'Next',
    play: 'Play',
    pause: 'Pause',
    reset: 'Reset',
  },
  notFound: {
    title: 'Page not found',
    description: 'The page you are looking for does not exist.',
    backHome: 'Back to home',
  },
}

export type Messages = DeepReadonly<typeof en>
