// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  attributeSize,
  channelDataHeader,
  decodeXorAddress,
  fingerprint,
  hex,
  hex16,
  messageLength,
  messageType,
  paddedSize,
  stunHeader,
  transactionIdBytes,
  xorAddress,
} from './stun'

describe('STUN のメッセージの型（RFC 8489 §5、RFC 8656 §17）', () => {
  it('メソッドとクラスのビットを挟み込む', () => {
    expect(
      [
        messageType(0x001, 'request'),
        messageType(0x001, 'indication'),
        messageType(0x001, 'success'),
        messageType(0x001, 'error'),
        messageType(0x003, 'request'),
        messageType(0x003, 'success'),
        messageType(0x003, 'error'),
        messageType(0x004, 'request'),
        messageType(0x006, 'indication'),
        messageType(0x007, 'indication'),
        messageType(0x008, 'request'),
        messageType(0x009, 'request'),
        messageType(0x009, 'success'),
      ].map(hex16),
    ).toEqual([
      '0x0001',
      '0x0011',
      '0x0101',
      '0x0111',
      '0x0003',
      '0x0103',
      '0x0113',
      '0x0004',
      '0x0016',
      '0x0017',
      '0x0008',
      '0x0009',
      '0x0109',
    ])
  })
})

describe('XOR-MAPPED-ADDRESS（RFC 8489 §14.2）', () => {
  it('RFC 5769 §2.2 のテストベクター: 192.0.2.1:32853', () => {
    expect(hex(xorAddress('192.0.2.1', 32853))).toBe('00 01 a1 47 e1 12 a6 43')
  })

  it('このページのアドレスと、元に戻す計算', () => {
    expect(hex(xorAddress('203.0.113.5', 40001))).toBe('00 01 bd 53 ea 12 d5 47')
    expect(hex(xorAddress('192.0.2.77', 60001))).toBe('00 01 cb 73 e1 12 a6 0f')
    expect(hex(xorAddress('198.51.100.3', 55000))).toBe('00 01 f7 ca e7 21 c0 41')
    expect(decodeXorAddress(xorAddress('192.0.2.77', 60003))).toEqual({
      ip: '192.0.2.77',
      port: 60003,
    })
  })
})

describe('長さとヘッダー', () => {
  it('属性は 4 バイトの境界に詰め、Message Length はヘッダーを含まない', () => {
    expect([attributeSize(4), attributeSize(9), attributeSize(20), attributeSize(32)]).toEqual([
      8, 16, 24, 36,
    ])
    // Binding の Success Response: XOR-MAPPED-ADDRESS（8 バイト）だけ
    expect(messageLength([8])).toBe(12)
  })

  it('20 バイトのヘッダー: 型、長さ、マジッククッキー、トランザクション ID', () => {
    const header = stunHeader(0x0001, 0, transactionIdBytes('5a3c91e07d42b816c90f2ea7'))
    expect(header).toHaveLength(20)
    expect(hex(header)).toBe('00 01 00 00 21 12 a4 42 5a 3c 91 e0 7d 42 b8 16 c9 0f 2e a7')
  })

  it('ChannelData は 4 バイトのヘッダーで、TCP・TLS の上では 4 の倍数に詰める', () => {
    expect(hex(channelDataHeader(0x4000, 122))).toBe('40 00 00 7a')
    expect(paddedSize(4 + 122)).toBe(128)
  })
})

describe('FINGERPRINT（RFC 8489 §14.7）', () => {
  it('RFC 5769 §2.2 の応答: 0xc07d4c96', () => {
    // RFC 5769 §2.2 のサンプルの IPv4 の応答（FINGERPRINT の属性の前まで。ヘッダーの長さは FINGERPRINT を含む）
    const bytes = [
      0x01, 0x01, 0x00, 0x3c, 0x21, 0x12, 0xa4, 0x42, 0xb7, 0xe7, 0xa7, 0x01, 0xbc, 0x34, 0xd6,
      0x86, 0xfa, 0x87, 0xdf, 0xae, 0x80, 0x22, 0x00, 0x0b, 0x74, 0x65, 0x73, 0x74, 0x20, 0x76,
      0x65, 0x63, 0x74, 0x6f, 0x72, 0x20, 0x00, 0x20, 0x00, 0x08, 0x00, 0x01, 0xa1, 0x47, 0xe1,
      0x12, 0xa6, 0x43, 0x00, 0x08, 0x00, 0x14, 0x2b, 0x91, 0xf5, 0x99, 0xfd, 0x9e, 0x90, 0xc3,
      0x8c, 0x74, 0x89, 0xf9, 0x2a, 0xf9, 0xba, 0x53, 0xf0, 0x6b, 0xe7, 0xd7,
    ]
    expect(fingerprint(bytes).toString(16)).toBe('c07d4c96')
  })
})
