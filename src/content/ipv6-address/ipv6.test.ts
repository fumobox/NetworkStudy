// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  classify,
  DEFAULT_ADDRESS,
  DEFAULT_PREFIX,
  eui64FromMac,
  formatCanonical,
  formatFull,
  formatMac,
  interfaceId,
  linkLocalFromMac,
  macFromEui64,
  multicastMac,
  multicastScope,
  networkPrefix,
  parseIPv6,
  parseMac,
  readIpv6Query,
  solicitedNode,
  wellKnownGroup,
  type Groups,
} from './ipv6'

function groups(text: string): Groups {
  const parsed = parseIPv6(text)
  if (parsed === null) {
    throw new Error(`invalid: ${text}`)
  }
  return parsed
}

const canonical = (text: string) => formatCanonical(groups(text))

describe('parseIPv6（RFC 4291 §2.2）', () => {
  it('省略のない表記、:: による省略、大文字、末尾の IPv4 の表記を読む', () => {
    expect(parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0, 0, 1,
    ])
    expect(parseIPv6('2001:DB8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIPv6('fe80::')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIPv6('::ffff:192.0.2.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201])
    expect(parseIPv6('  ::1  ')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    // :: で 1 つのグループだけを省いた表記も読める（RFC 4291。出力では使わない、RFC 5952 §4.2.2）
    expect(parseIPv6('::1:2:3:4:5:6:7')).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(parseIPv6('1:2:3:4:5:6:7::')).toEqual([1, 2, 3, 4, 5, 6, 7, 0])
    expect(parseIPv6('1:2:3:4:5:6:1.2.3.4')).toEqual([1, 2, 3, 4, 5, 6, 0x102, 0x304])
    expect(parseIPv6('1::1.2.3.4')).toEqual([1, 0, 0, 0, 0, 0, 0x102, 0x304])
  })

  it('正しくない表記は null', () => {
    for (const text of [
      '',
      '1::2::3',
      '2001:db8:0:0:0:0:0:0:1',
      '2001:db8:0:0:0:0:1',
      '12345::1',
      'g::1',
      ':1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7::8',
      '::ffff:256.0.0.1',
      '192.0.2.1::1',
      'fe80::1%eth0',
      '1:::2',
      ':::',
      '::1.2.3.4:5',
      '::ffff:1.2.3',
      '::ffff:1.2.3.4.5',
      // IPv4 の部分の先頭の 0 は認めない（8 進数と読まれるおそれがある）
      '::ffff:01.2.3.4',
    ]) {
      expect(parseIPv6(text), text).toBeNull()
    }
  })
})

describe('formatFull / formatCanonical（RFC 5952）', () => {
  it('省略しない表記は 4 桁ずつ', () => {
    expect(formatFull(groups('2001:db8::1'))).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
  })

  it('§4.1 先頭の 0 を省き、§4.3 小文字にする', () => {
    expect(canonical('2001:0DB8:00A0:0000:0000:0000:0000:0001')).toBe('2001:db8:a0::1')
  })

  it('§4.2.1 いちばん長い 0 の続きを :: にする', () => {
    expect(canonical('2001:db8:0:0:1:0:0:0')).toBe('2001:db8:0:0:1::')
    expect(canonical('2001:0db8:0000:0000:0001:0000:0000:0001')).toBe('2001:db8::1:0:0:1')
  })

  it('§4.2.2 0 が 1 つだけなら :: にしない', () => {
    expect(canonical('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1')
    expect(canonical('::1:2:3:4:5:6:7')).toBe('0:1:2:3:4:5:6:7')
    expect(canonical('1:2:3:4:5:6:7::')).toBe('1:2:3:4:5:6:7:0')
  })

  it('§4.2.3 同じ長さなら最初の続きを :: にする', () => {
    expect(canonical('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1')
  })

  it('すべて 0、ループバック、リンクローカル', () => {
    expect(canonical('0:0:0:0:0:0:0:0')).toBe('::')
    expect(canonical('0:0:0:0:0:0:0:1')).toBe('::1')
    expect(canonical('fe80:0:0:0:200:5eff:fe00:530a')).toBe('fe80::200:5eff:fe00:530a')
  })

  it('§5 IPv4 射影アドレスは末尾を IPv4 の表記で書く', () => {
    expect(canonical('0:0:0:0:0:ffff:c000:201')).toBe('::ffff:192.0.2.1')
    // 廃止された IPv4 互換アドレス（::/96）は IPv4 の表記にしない
    expect(canonical('::1.2.3.4')).toBe('::102:304')
  })
})

describe('classify（RFC 4291 §2.4 ほか）', () => {
  it.each([
    ['::', 'unspecified', '::/128'],
    ['::1', 'loopback', '::1/128'],
    ['::ffff:192.0.2.1', 'ipv4Mapped', '::ffff:0:0/96'],
    ['ff02::1', 'multicast', 'ff00::/8'],
    ['fe80::1', 'linkLocal', 'fe80::/10'],
    ['febf::1', 'linkLocal', 'fe80::/10'],
    ['fd12:3456::1', 'uniqueLocal', 'fc00::/7'],
    ['2001:db8::1', 'documentation', '2001:db8::/32'],
    ['3fff:123::1', 'documentation', '3fff::/20'],
    ['2400:cb00::1', 'globalUnicast', '2000::/3'],
    ['fec0::1', 'reserved', null],
    ['::2', 'reserved', null],
    ['::1.2.3.4', 'reserved', null],
    ['3fff:fff::1', 'documentation', '3fff::/20'],
    ['3fff:1000::1', 'globalUnicast', '2000::/3'],
    ['2001:db9::1', 'globalUnicast', '2000::/3'],
    ['4000::1', 'reserved', null],
    ['1fff::1', 'reserved', null],
    ['fe00::1', 'reserved', null],
    ['fbff::1', 'reserved', null],
  ])('%s は %s（%s）', (text, kind, range) => {
    expect(classify(groups(text))).toEqual({ kind, range })
  })
})

describe('マルチキャスト（RFC 4291 §2.7、§2.7.1、RFC 2464 §7）', () => {
  it('scope は先頭のグループの下位 4 ビット', () => {
    expect(multicastScope(groups('ff02::1'))).toBe('linkLocal')
    expect(multicastScope(groups('ff05::2'))).toBe('siteLocal')
    expect(multicastScope(groups('ff0e::101'))).toBe('global')
    expect(multicastScope(groups('ff01::1'))).toBe('interfaceLocal')
    expect(multicastScope(groups('ff03::1'))).toBe('realmLocal')
    expect(multicastScope(groups('ff04::1'))).toBe('adminLocal')
    expect(multicastScope(groups('ff08::1'))).toBe('organizationLocal')
    expect(multicastScope(groups('ff00::1'))).toBe('reserved')
    expect(multicastScope(groups('ff0f::1'))).toBe('reserved')
    expect(multicastScope(groups('ff06::1'))).toBe('unassigned')
    // フラグ（上位 4 ビット）は scope に関係しない
    expect(multicastScope(groups('ff12::1'))).toBe('linkLocal')
  })

  it('よく使うグループ', () => {
    expect(wellKnownGroup(groups('ff02::1'))).toBe('allNodes')
    expect(wellKnownGroup(groups('ff02::2'))).toBe('allRouters')
    expect(wellKnownGroup(groups('ff02::1:ff00:530a'))).toBe('solicitedNode')
    expect(wellKnownGroup(groups('ff02::fb'))).toBeNull()
    expect(wellKnownGroup(groups('ff05::1'))).toBeNull()
    expect(wellKnownGroup(groups('ff02::1:fe00:1'))).toBeNull()
    expect(wellKnownGroup(groups('ff02::1:ffff:ffff'))).toBe('solicitedNode')
  })

  it('要請ノードマルチキャストアドレスは、ff02::1:ff と下位 24 ビット', () => {
    const solicited = solicitedNode(groups(DEFAULT_ADDRESS))
    expect(formatCanonical(solicited)).toBe('ff02::1:ff00:530a')
    expect(multicastMac(solicited)).toBe('33:33:ff:00:53:0a')
    expect(multicastMac(groups('ff02::1'))).toBe('33:33:00:00:00:01')
  })
})

describe('プレフィックスとインターフェース ID', () => {
  it('/64 で分ける', () => {
    const address = groups(DEFAULT_ADDRESS)
    expect(formatCanonical(networkPrefix(address, 64))).toBe('2001:db8:1::')
    expect(formatCanonical(interfaceId(address, 64))).toBe('::200:5eff:fe00:530a')
  })

  it('16 の倍数でない長さ、0 と 128', () => {
    const address = groups('2001:db8:abcd:ffff::1')
    expect(formatCanonical(networkPrefix(address, 56))).toBe('2001:db8:abcd:ff00::')
    expect(formatCanonical(networkPrefix(address, 0))).toBe('::')
    expect(networkPrefix(address, 128)).toEqual(address)
    expect(formatCanonical(interfaceId(address, 128))).toBe('::')
    expect(interfaceId(address, 0)).toEqual(address)
    const ones = groups('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(formatCanonical(networkPrefix(ones, 1))).toBe('8000::')
    expect(formatCanonical(networkPrefix(ones, 15))).toBe('fffe::')
    expect(formatCanonical(networkPrefix(ones, 17))).toBe('ffff:8000::')
    expect(formatCanonical(networkPrefix(ones, 127))).toBe(
      'ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe',
    )
  })
})

describe('MAC アドレスと EUI-64（RFC 4291 付録 A、RFC 2464 §4）', () => {
  it('ff:fe を挟み、U/L ビットを反転する', () => {
    const mac = parseMac('00:00:5e:00:53:0a')
    expect(mac).toEqual([0, 0, 0x5e, 0, 0x53, 0x0a])
    expect(mac === null ? null : eui64FromMac(mac)).toEqual([0x0200, 0x5eff, 0xfe00, 0x530a])
    expect(mac === null ? null : formatCanonical(linkLocalFromMac(mac))).toBe(
      'fe80::200:5eff:fe00:530a',
    )
    // U/L ビットがもともと 1 なら 0 になる
    const local = parseMac('02-00-5E-00-53-01')
    expect(local === null ? null : eui64FromMac(local)[0]).toBe(0x0000)
  })

  it('EUI-64 のインターフェース ID から MAC アドレスを戻す', () => {
    const mac = macFromEui64(groups(DEFAULT_ADDRESS))
    expect(mac === null ? null : formatMac(mac)).toBe('00:00:5e:00:53:0a')
    expect(macFromEui64(groups('2001:db8::1'))).toBeNull()
  })

  it('MAC アドレスの表記', () => {
    expect(parseMac('00:00:5e:00:53')).toBeNull()
    expect(parseMac('zz:00:5e:00:53:0a')).toBeNull()
    expect(parseMac('00:00:5e:00:53:0a:01')).toBeNull()
    // 区切りはそろえる
    expect(parseMac('00:00-5e:00-53:0a')).toBeNull()
    expect(formatMac([0, 0, 0x5e, 0, 0x53, 0x0a])).toBe('00:00:5e:00:53:0a')
  })
})

describe('readIpv6Query', () => {
  it('正しい値はそのまま、不正な値は既定に戻す', () => {
    expect(readIpv6Query(new URLSearchParams('address=fe80::1&prefix=10'))).toEqual({
      address: 'fe80::1',
      prefix: 10,
    })
    expect(readIpv6Query(new URLSearchParams('address=1::2::3&prefix=129'))).toEqual({
      address: DEFAULT_ADDRESS,
      prefix: DEFAULT_PREFIX,
    })
    for (const [query, prefix] of [
      ['prefix=0', 0],
      ['prefix=128', 128],
      ['prefix=064', DEFAULT_PREFIX],
      ['prefix=-1', DEFAULT_PREFIX],
    ] as const) {
      expect(readIpv6Query(new URLSearchParams(query)).prefix, query).toBe(prefix)
    }
    expect(readIpv6Query(new URLSearchParams('address=%20FE80::1%20')).address).toBe('FE80::1')
    expect(readIpv6Query(new URLSearchParams('prefix='))).toEqual({
      address: DEFAULT_ADDRESS,
      prefix: DEFAULT_PREFIX,
    })
  })
})
