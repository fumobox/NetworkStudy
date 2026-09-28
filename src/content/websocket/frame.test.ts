// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  closePayload,
  frameHeader,
  hex,
  lengthEncoding,
  maskPayload,
  utf8,
  type MaskingKey,
} from './frame'

const RFC_KEY: MaskingKey = [0x37, 0xfa, 0x21, 0x3d]

describe('WebSocket のフレーム（RFC 6455 §5.7 の例）', () => {
  it('マスクのない 1 つのフレームのテキスト "Hello"', () => {
    const payload = utf8('Hello')
    expect(hex([...frameHeader({ fin: true, opcode: 'text', length: 5 }), ...payload])).toBe(
      '0x81 0x05 0x48 0x65 0x6c 0x6c 0x6f',
    )
  })

  it('マスクした "Hello"', () => {
    const payload = utf8('Hello')
    const header = frameHeader({ fin: true, opcode: 'text', length: 5, maskingKey: RFC_KEY })
    expect(hex([...header, ...maskPayload(payload, RFC_KEY)])).toBe(
      '0x81 0x85 0x37 0xfa 0x21 0x3d 0x7f 0x9f 0x4d 0x51 0x58',
    )
  })

  it('フラグメントに分けた "Hel" と "lo"', () => {
    expect(hex([...frameHeader({ fin: false, opcode: 'text', length: 3 }), ...utf8('Hel')])).toBe(
      '0x01 0x03 0x48 0x65 0x6c',
    )
    expect(
      hex([...frameHeader({ fin: true, opcode: 'continuation', length: 2 }), ...utf8('lo')]),
    ).toBe('0x80 0x02 0x6c 0x6f')
  })

  it('Ping と、同じ本文を返すマスクした Pong', () => {
    expect(hex([...frameHeader({ fin: true, opcode: 'ping', length: 5 }), ...utf8('Hello')])).toBe(
      '0x89 0x05 0x48 0x65 0x6c 0x6c 0x6f',
    )
    const pong = frameHeader({ fin: true, opcode: 'pong', length: 5, maskingKey: RFC_KEY })
    expect(hex([...pong, ...maskPayload(utf8('Hello'), RFC_KEY)])).toBe(
      '0x8a 0x85 0x37 0xfa 0x21 0x3d 0x7f 0x9f 0x4d 0x51 0x58',
    )
  })

  it('256 バイトは 16 ビット、64 KiB は 64 ビットの長さ', () => {
    expect(hex(frameHeader({ fin: true, opcode: 'binary', length: 256 }))).toBe(
      '0x82 0x7e 0x01 0x00',
    )
    expect(hex(frameHeader({ fin: true, opcode: 'binary', length: 65536 }))).toBe(
      '0x82 0x7f 0x00 0x00 0x00 0x00 0x00 0x01 0x00 0x00',
    )
    expect([125, 126, 65535, 65536].map(lengthEncoding)).toEqual([
      '7-bit',
      '7+16-bit',
      '7+16-bit',
      '7+64-bit',
    ])
  })

  it('マスクをもう一度かけると元に戻り、Close 1000 は 0x03 0xe8', () => {
    const payload = utf8('Hello')
    expect(maskPayload(maskPayload(payload, RFC_KEY), RFC_KEY)).toEqual(payload)
    expect(hex(closePayload(1000))).toBe('0x03 0xe8')
  })
})
