// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { base64, base64url, clientSecretBasic, utf8 } from './encoding'

describe('base64（RFC 4648 §10 のテストベクター）', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('%s → %s', (input, output) => {
    expect(base64(utf8(input))).toBe(output)
  })

  it('base64url は - と _ を使い、= を付けない', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf])
    expect(base64(bytes)).toBe('+/+/')
    expect(base64url(bytes)).toBe('-_-_')
    expect(base64url(utf8('f'))).toBe('Zg')
  })
})

describe('clientSecretBasic（RFC 6749 §2.3.1）', () => {
  it('RFC 6749 §4.1.3 の例と同じ', () => {
    expect(clientSecretBasic('s6BhdRkqt3', 'gX1fBat3bV')).toBe('Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW')
  })

  it('base64 にする前に form-urlencode する', () => {
    expect(clientSecretBasic('a b', 'c:d')).toBe(`Basic ${base64(utf8('a+b:c%3Ad'))}`)
  })
})
