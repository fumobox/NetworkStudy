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
  it('保存済みの設定を最優先する', () => {
    expect(detectLocale({ stored: 'ja', languages: ['en-US'] })).toBe('ja')
  })

  it('保存済みの値が不正なら無視してブラウザの言語を使う', () => {
    expect(detectLocale({ stored: 'fr', languages: ['ja-JP'] })).toBe('ja')
    expect(detectLocale({ stored: null, languages: ['ja-JP'] })).toBe('ja')
  })

  it('ブラウザの言語は優先順に最初に対応するものを使う', () => {
    expect(detectLocale({ stored: null, languages: ['fr-FR', 'ja', 'en'] })).toBe('ja')
  })

  it('どれにも対応しなければデフォルトの en', () => {
    expect(detectLocale({ stored: null, languages: ['fr-FR', 'de'] })).toBe('en')
    expect(detectLocale({ stored: undefined, languages: [] })).toBe('en')
  })
})
