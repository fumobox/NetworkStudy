// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LOCALES } from '../locale'
import { LOCALE_NAMES, MESSAGES } from './index'

interface Leaf {
  path: string
  value: unknown
}

function collectLeaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, child]) =>
      collectLeaves(child, path === '' ? key : `${path}.${key}`),
    )
  }
  return [{ path, value: node }]
}

describe('UI 文言の辞書', () => {
  it.each(LOCALES)('%s の文字列は空でも仮置きでもない', (locale) => {
    const strings = collectLeaves(MESSAGES[locale]).filter((leaf) => typeof leaf.value === 'string')
    expect(strings.length).toBeGreaterThan(0)
    for (const { path, value } of strings) {
      expect(value, path).not.toBe('')
      expect(value, path).not.toMatch(/TODO|FIXME/)
    }
  })

  // 型（satisfies Messages）はオブジェクトリテラルを直書きした余剰キーしか検出できない。
  // スプレッドや変数経由で混入した余剰キーはこのテストで検出する
  it('全ロケールでキー構成が同じ', () => {
    const paths = LOCALES.map((locale) =>
      collectLeaves(MESSAGES[locale])
        .map((leaf) => leaf.path)
        .sort(),
    )
    for (const other of paths.slice(1)) {
      expect(other).toEqual(paths[0])
    }
  })

  it('関数の文言は引数を埋め込む', () => {
    expect(MESSAGES.en.stepper.counter({ current: 2, total: 5 })).toBe('Step 2 of 5')
    expect(MESSAGES.ja.stepper.counter({ current: 2, total: 5 })).toBe('ステップ 2 / 5')
  })

  it('全ロケールの言語名がある', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_NAMES[locale]).not.toBe('')
    }
  })
})
