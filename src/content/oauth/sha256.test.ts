// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { utf8 } from './encoding'
import { sha256 } from './sha256'

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

describe('sha256（FIPS 180-4）', () => {
  it('NIST のテストベクター', () => {
    expect(hex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(hex(sha256(utf8('a'.repeat(1_000_000))))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  it('ブロックの境目（55、56、63、64、65 バイト）で Web Crypto と一致する', async () => {
    for (const length of [55, 56, 63, 64, 65, 119, 120]) {
      const data = utf8('x'.repeat(length))
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
      expect(hex(sha256(data)), String(length)).toBe(hex(expected))
    }
  })
})
