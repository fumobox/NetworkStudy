// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseStrictTransportSecurity } from './sts'

const ok = (value: string) => {
  const result = parseStrictTransportSecurity(value)
  return result.ok
    ? { maxAge: result.maxAge, sub: result.includeSubDomains, unknown: result.unknown }
    : null
}

describe('Strict-Transport-Security の解析（RFC 6797 §6.1）', () => {
  it('§6.2 の例をすべて受け付ける', () => {
    expect(ok('max-age=31536000')).toEqual({ maxAge: 31536000, sub: false, unknown: [] })
    expect(ok('max-age=15768000 ; includeSubDomains')).toEqual({
      maxAge: 15768000,
      sub: true,
      unknown: [],
    })
    expect(ok('max-age="31536000"')).toEqual({ maxAge: 31536000, sub: false, unknown: [] })
    expect(ok('max-age=0')).toEqual({ maxAge: 0, sub: false, unknown: [] })
    expect(ok('max-age=0; includeSubDomains')).toEqual({ maxAge: 0, sub: true, unknown: [] })
  })

  it('空のディレクティブ、空白、名前の大文字小文字を許す', () => {
    expect(ok(';max-age=1;;')?.maxAge).toBe(1)
    expect(ok('max-age = 7776000')?.maxAge).toBe(7776000)
    expect(ok('MAX-AGE=1; IncludeSubDomains')).toEqual({ maxAge: 1, sub: true, unknown: [] })
  })

  it('重複、max-age の欠落、数字でない値は全体を無視する', () => {
    for (const value of [
      'max-age=1; max-age=2',
      'max-age=1; includeSubDomains; includeSubDomains',
      'includeSubDomains',
      'max-age=',
      'max-age=-1',
      'max-age=1.5',
      'max-age="3153 6000"',
      'max-age="1',
      'max-age=1; includeSubDomains=x',
    ]) {
      expect(parseStrictTransportSecurity(value).ok, value).toBe(false)
    }
  })

  it('知らないディレクティブ（preload も）は無視して、ほかを処理する', () => {
    expect(ok('max-age=31536000; includeSubDomains; preload')).toEqual({
      maxAge: 31536000,
      sub: true,
      unknown: ['preload'],
    })
    expect(ok('foo="a;b"; max-age=1')).toEqual({ maxAge: 1, sub: false, unknown: ['foo'] })
  })
})
