// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { plannedPages } from './pages'

const theme = (id: string) => ({
  id,
  title: { en: `Theme ${id}`, ja: `テーマ ${id}` },
  summary: { en: `About ${id}`, ja: `${id} について` },
})

describe('plannedPages', () => {
  it('ロケールなしのページとロケール付きのページを、ルートごとに生成する', () => {
    const files = plannedPages([theme('tcp')]).map((page) => page.file)
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

  it('テーマページのタイトルと説明にテーマ名と概要を使う', () => {
    const pages = plannedPages([theme('tcp')])
    expect(pages.find((page) => page.file === 'ja/themes/tcp/index.html')?.meta).toEqual({
      lang: 'ja',
      title: 'テーマ tcp | NetworkStudy',
      description: 'tcp について',
    })
    expect(pages.find((page) => page.file === 'themes/tcp/index.html')?.meta.title).toBe(
      'Theme tcp | NetworkStudy',
    )
  })

  it('既定では公開中のテーマ（THEME_META）のページを作る', () => {
    expect(plannedPages().map((page) => page.file)).toContain('ja/themes/tcp-handshake/index.html')
  })

  it.each([['TCP'], ['tcp handshake'], ['../x'], ['a/b'], ['-tcp'], ['']])(
    '不正なテーマ ID %j は例外を投げる',
    (id) => {
      expect(() => plannedPages([theme(id)])).toThrow(/テーマ ID/)
    },
  )
})
