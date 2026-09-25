// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { detectLocale, matchLocale } from './detect'

describe('matchLocale', () => {
  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['JA-jp', 'ja'],
    ['en-GB', 'en'],
    ['fr-FR', null],
    ['', null],
  ])('%j → %j', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected)
  })
})

describe('detectLocale', () => {
  it('URL の言語タグが対応言語なら最優先する', () => {
    expect(detectLocale({ pathTag: 'ja-JP', stored: 'en', languages: ['en-US'] })).toBe('ja')
  })

  it('URL の言語タグが対応外なら保存済みの設定・ブラウザーの言語を使う', () => {
    expect(detectLocale({ pathTag: 'fr', stored: 'ja', languages: ['en-US'] })).toBe('ja')
    expect(detectLocale({ pathTag: 'fr', stored: null, languages: ['ja'] })).toBe('ja')
  })

  it('保存済みの設定を最優先する', () => {
    expect(detectLocale({ pathTag: null, stored: 'ja', languages: ['en-US'] })).toBe('ja')
  })

  it('保存済みの値が不正なら無視してブラウザーの言語を使う', () => {
    expect(detectLocale({ pathTag: null, stored: 'fr', languages: ['ja-JP'] })).toBe('ja')
    expect(detectLocale({ pathTag: null, stored: null, languages: ['ja-JP'] })).toBe('ja')
  })

  it('ブラウザーの言語は優先順に最初に対応するものを使う', () => {
    expect(detectLocale({ pathTag: null, stored: null, languages: ['fr-FR', 'ja', 'en'] })).toBe(
      'ja',
    )
  })

  it('どれにも対応しなければデフォルトの en', () => {
    expect(detectLocale({ pathTag: null, stored: null, languages: ['fr-FR', 'de'] })).toBe('en')
    expect(detectLocale({ pathTag: null, stored: undefined, languages: [] })).toBe('en')
  })
})
