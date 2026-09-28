// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  appendForwarded,
  appendVia,
  appendXForwardedFor,
  clientIpFromXForwardedFor,
  formatCacheStatus,
  formatForwardedElement,
  formatProxyStatus,
  forwardedNode,
  isToken,
  quoteIfNeeded,
  sfItem,
  stripHopByHop,
  viaMember,
  xffToForwarded,
} from './headers'

describe('token と quoted-string（RFC 9110 §5.6.2、§5.6.4）', () => {
  it('tchar だけなら token、そうでなければ引用符で囲み、" と \\ をエスケープする', () => {
    expect(isToken('192.0.2.60')).toBe(true)
    expect(isToken('[2001:db8::17]')).toBe(false)
    expect(quoteIfNeeded('_hidden')).toBe('_hidden')
    expect(quoteIfNeeded('a"b\\c')).toBe('"a\\"b\\\\c"')
  })
})

describe('Forwarded（RFC 7239）', () => {
  it('§4 と §6 の例: IPv6 とポート付きのノードは引用符で囲む', () => {
    expect(forwardedNode('2001:db8:cafe::17', 4711)).toBe('"[2001:db8:cafe::17]:4711"')
    expect(forwardedNode('192.0.2.60')).toBe('192.0.2.60')
    expect(forwardedNode('192.0.2.60', 51514)).toBe('"192.0.2.60:51514"')
    expect(
      formatForwardedElement({
        for: forwardedNode('192.0.2.60'),
        by: forwardedNode('203.0.113.43'),
        proto: 'http',
      }),
    ).toBe('for=192.0.2.60;by=203.0.113.43;proto=http')
  })

  it('§7.5 の例: 2 台目のプロキシが前の値の後ろに足す', () => {
    const first = appendForwarded(null, { for: forwardedNode('192.0.2.43') })
    expect(first).toBe('for=192.0.2.43')
    expect(
      appendForwarded(first, {
        for: forwardedNode('198.51.100.17'),
        by: forwardedNode('203.0.113.60'),
        proto: 'http',
        host: 'example.com',
      }),
    ).toBe('for=192.0.2.43, for=198.51.100.17;by=203.0.113.60;proto=http;host=example.com')
  })

  it('§7.4 の例: X-Forwarded-For からの書き換え', () => {
    expect(xffToForwarded('192.0.2.43, 2001:db8:cafe::17')).toBe(
      'for=192.0.2.43, for="[2001:db8:cafe::17]"',
    )
  })
})

describe('X-Forwarded-For', () => {
  it('IPv6 も [] で囲まずに後ろへ足す', () => {
    expect(appendXForwardedFor(null, '203.0.113.50')).toBe('203.0.113.50')
    expect(appendXForwardedFor('203.0.113.50', '2001:db8::17')).toBe('203.0.113.50, 2001:db8::17')
  })

  it('クライアントが書いた左の値は信じず、信頼できるプロキシが付けた右からの値を使う', () => {
    const spoofed = '192.0.2.99, 203.0.113.50'
    expect(clientIpFromXForwardedFor(spoofed, 1)).toBe('203.0.113.50')
    expect(clientIpFromXForwardedFor('203.0.113.50, 198.51.100.7', 2)).toBe('203.0.113.50')
    expect(clientIpFromXForwardedFor('203.0.113.50', 2)).toBeUndefined()
  })
})

describe('Via（RFC 9110 §7.6.3）', () => {
  it('§7.6.3 の例と同じ形', () => {
    expect(appendVia(viaMember('1.0', 'fred'), viaMember('1.1', 'p.example.net'))).toBe(
      '1.0 fred, 1.1 p.example.net',
    )
  })
})

describe('区間ごとのフィールド（RFC 9110 §7.6.1）', () => {
  it('Connection に並んだフィールドと、決まったフィールドを外す', () => {
    const { forwarded, removed } = stripHopByHop([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Connection', value: 'keep-alive, X-Foo' },
      { name: 'Keep-Alive', value: 'timeout=5' },
      { name: 'X-Foo', value: '1' },
      { name: 'Transfer-Encoding', value: 'chunked' },
    ])
    expect(forwarded.map((f) => f.name)).toEqual(['Content-Type'])
    expect(removed).toEqual(['Connection', 'Keep-Alive', 'X-Foo', 'Transfer-Encoding'])
  })
})

describe('Structured Field（RFC 9651）と Proxy-Status・Cache-Status', () => {
  it('数字で始まる値は String にする', () => {
    expect(sfItem('backend.example.org:8001')).toBe('backend.example.org:8001')
    expect(sfItem('198.51.100.12:8080')).toBe('"198.51.100.12:8080"')
  })

  it('RFC 9209 の形', () => {
    expect(formatProxyStatus('ExampleCDN', 'connection_timeout')).toBe(
      'ExampleCDN; error=connection_timeout',
    )
    expect(formatProxyStatus('proxy1', 'connection_terminated', '198.51.100.12:8080')).toBe(
      'proxy1; error=connection_terminated; next-hop="198.51.100.12:8080"',
    )
  })

  it('RFC 9211 §3 の例', () => {
    expect(formatCacheStatus('ExampleCache', { hit: true, ttl: 376 })).toBe(
      'ExampleCache; hit; ttl=376',
    )
    expect(formatCacheStatus('ExampleCache', { fwd: 'uri-miss' })).toBe(
      'ExampleCache; fwd=uri-miss',
    )
    expect(formatCacheStatus('proxy1', { fwd: 'uri-miss', stored: true })).toBe(
      'proxy1; fwd=uri-miss; stored',
    )
  })
})
