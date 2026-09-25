// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findTextProblems } from './textProblems'

describe('findTextProblems', () => {
  it('空欄と仮置きを、ロケールごとに検出する', () => {
    expect(
      findTextProblems([
        { path: 'a', text: { en: 'OK', ja: 'OK' } },
        { path: 'b', text: { en: ' ', ja: 'TODO: 訳す' } },
        { path: 'c', text: { en: 'FIXME later', ja: 'todo は小文字なので対象外' } },
      ]),
    ).toEqual([
      { path: 'b.en', message: 'text is empty' },
      { path: 'b.ja', message: 'text contains a placeholder' },
      { path: 'c.en', message: 'text contains a placeholder' },
    ])
  })
})
