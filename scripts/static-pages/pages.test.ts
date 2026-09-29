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
    const files = plannedPages({ themes: [theme('tcp')], paths: [] }).map((page) => page.file)
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
    const root = plannedPages({ themes: [], paths: [] }).find((page) => page.file === 'index.html')
    expect(root?.locale).toBeNull()
    expect(root?.meta.lang).toBe('en')
  })

  it('ページごとに辞書のタイトルと説明を使う', () => {
    const ja = plannedPages({ themes: [], paths: [] }).find((page) => page.file === 'ja/index.html')
    expect(ja?.meta.title).toBe('NetworkStudy')
    expect(ja?.meta.description).toMatch(/1 パケットずつ/)
  })

  it('テーマページのタイトルと説明にテーマ名と概要を使う', () => {
    const pages = plannedPages({ themes: [theme('tcp')], paths: [] })
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

  it('道筋のページは、タイトルに道筋の名前を、説明に道筋の説明を使う', () => {
    const path = {
      id: 'web',
      title: { en: 'Web developers', ja: 'Web エンジニア向け' },
      summary: { en: 'For the web', ja: 'Web のため' },
    }
    const pages = plannedPages({ themes: [theme('tcp')], paths: [path] })
    expect(pages.map((page) => page.file)).toEqual([
      'index.html',
      'themes/tcp/index.html',
      'paths/web/index.html',
      'en/index.html',
      'en/themes/tcp/index.html',
      'en/paths/web/index.html',
      'ja/index.html',
      'ja/themes/tcp/index.html',
      'ja/paths/web/index.html',
    ])
    expect(pages.find((page) => page.file === 'ja/paths/web/index.html')?.meta).toEqual({
      lang: 'ja',
      title: '学習の道筋: Web エンジニア向け | NetworkStudy',
      description: 'Web のため',
    })
    expect(pages.find((page) => page.file === 'paths/web/index.html')?.meta.title).toBe(
      'Learning path: Web developers | NetworkStudy',
    )
  })

  it('既定では学習の道筋（LEARNING_PATHS）のページも作る', () => {
    expect(plannedPages().map((page) => page.file)).toContain('ja/paths/web-developer/index.html')
  })

  it('不正な道筋 ID は例外を投げる', () => {
    const path = { id: 'Web Dev', title: { en: 'x', ja: 'x' }, summary: { en: 'x', ja: 'x' } }
    expect(() => plannedPages({ themes: [], paths: [path] })).toThrow(/道筋 ID/)
  })

  it.each([['TCP'], ['tcp handshake'], ['../x'], ['a/b'], ['-tcp'], ['']])(
    '不正なテーマ ID %j は例外を投げる',
    (id) => {
      expect(() => plannedPages({ themes: [theme(id)], paths: [] })).toThrow(/テーマ ID/)
    },
  )
})
