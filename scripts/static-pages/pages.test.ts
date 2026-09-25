// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { plannedPages } from './pages'

describe('plannedPages', () => {
  it('ロケールなしのページとロケール付きのページを、ルートごとに生成する', () => {
    const files = plannedPages(['tcp']).map((page) => page.file)
    expect(files).toEqual([
      'index.html',
      'themes/tcp/index.html',
      'en/index.html',
      'en/themes/tcp/index.html',
      'ja/index.html',
      'ja/themes/tcp/index.html',
    ])
  })

  it('ロケールなしのページはデフォルトロケールの言語で出す', () => {
    const root = plannedPages([]).find((page) => page.file === 'index.html')
    expect(root?.locale).toBeNull()
    expect(root?.meta.lang).toBe('en')
  })

  it('ページごとに辞書のタイトルと説明を使う', () => {
    const ja = plannedPages([]).find((page) => page.file === 'ja/index.html')
    expect(ja?.meta.title).toBe('NetworkStudy')
    expect(ja?.meta.description).toMatch(/1パケットずつ/)
  })

  it.each([['TCP'], ['tcp handshake'], ['../x'], ['a/b'], ['-tcp'], ['']])(
    '不正なテーマ ID %j は例外を投げる',
    (id) => {
      expect(() => plannedPages([id])).toThrow(/テーマ ID/)
    },
  )
})
