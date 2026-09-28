// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ACK_BYTES,
  AIFS_BE_US,
  CW_MAX,
  CW_MIN,
  DIFS_US,
  RTS_BYTES,
  ctsDurationUs,
  dataDurationUs,
  dataMpduBytes,
  nextCw,
  ofdmTxTimeUs,
  rtsDurationUs,
} from './airtime'

describe('OFDM の時間（IEEE Std 802.11-2024 clause 17）', () => {
  it('DIFS は 34 µs、ベストエフォートの AIFS は 43 µs', () => {
    expect(DIFS_US).toBe(34)
    expect(AIFS_BE_US).toBe(43)
  })

  it('TXTIME: Ack は 6 Mb/s で 44 µs、24 Mb/s で 28 µs。RTS は 6 Mb/s で 52 µs', () => {
    expect(ofdmTxTimeUs(ACK_BYTES, 6)).toBe(44)
    expect(ofdmTxTimeUs(ACK_BYTES, 24)).toBe(28)
    expect(ofdmTxTimeUs(RTS_BYTES, 6)).toBe(52)
    expect(ofdmTxTimeUs(RTS_BYTES, 24)).toBe(28)
  })

  it('100 バイトの IP パケットの MPDU は、保護して 152 バイト（24 Mb/s で 72 µs）、保護なしで 136 バイト', () => {
    expect(dataMpduBytes(100, true)).toBe(152)
    expect(ofdmTxTimeUs(152, 24)).toBe(72)
    expect(dataMpduBytes(100, false)).toBe(136)
  })

  it('Duration: データは 44 µs、RTS は 176 µs、CTS は 132 µs', () => {
    expect(dataDurationUs(24)).toBe(44)
    const rts = rtsDurationUs(152, 24)
    expect(rts).toBe(176)
    expect(ctsDurationUs(rts, 24)).toBe(132)
  })

  it('CW は失敗するたびに 2 倍 + 1 になり、1023 で止まる', () => {
    const sequence = [CW_MIN]
    for (let i = 0; i < 7; i++) {
      sequence.push(nextCw(sequence[sequence.length - 1] ?? CW_MIN))
    }
    expect(sequence).toEqual([15, 31, 63, 127, 255, 511, 1023, CW_MAX])
  })
})
