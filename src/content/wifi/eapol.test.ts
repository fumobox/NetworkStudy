// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { HANDSHAKE_KEY_INFO, hex16, keyInformation } from './eapol'

describe('Key Information（IEEE Std 802.11-2024 12.7.2）', () => {
  it('4 ウェイハンドシェイクの各メッセージ', () => {
    expect(([1, 2, 3, 4] as const).map((n) => hex16(HANDSHAKE_KEY_INFO[n]))).toEqual([
      '0x008a',
      '0x010a',
      '0x13ca',
      '0x030a',
    ])
  })

  it('何も立てなければ Key Descriptor Version（2）だけ', () => {
    expect(keyInformation({})).toBe(2)
  })
})
