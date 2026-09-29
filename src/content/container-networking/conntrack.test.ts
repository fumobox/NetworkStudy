// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  conntrackRow,
  dnat,
  masquerade,
  match,
  nextState,
  translate,
  untranslated,
  type Tuple,
} from './conntrack'

const A = { ip: '172.17.0.2', port: 40000 }
const B = { ip: '172.17.0.3', port: 40000 }
const SERVER = { ip: '203.0.113.80', port: 443 }
const OTHER_SERVER = { ip: '203.0.113.81', port: 443 }
const HOST = '198.51.100.10'
const CLIENT = { ip: '203.0.113.80', port: 50000 }

describe('masquerade', () => {
  it('送信元を出ていくアドレスに書き換え、重ならなければポートはそのまま', () => {
    const entry = masquerade([], { src: A, dst: SERVER }, HOST)
    expect(conntrackRow(entry)).toEqual([
      'TCP',
      '172.17.0.2:40000 → 203.0.113.80:443',
      '203.0.113.80:443 → 198.51.100.10:40000',
      'SYN_SENT',
    ])
  })

  it('同じ宛先へ同じ送信元ポートで来たら、別のポートにする。宛先が違えばそのまま', () => {
    const first = masquerade([], { src: A, dst: SERVER }, HOST)
    expect(masquerade([first], { src: B, dst: SERVER }, HOST).reply.dst).toEqual({
      ip: HOST,
      port: 40001,
    })
    expect(masquerade([first], { src: B, dst: OTHER_SERVER }, HOST).reply.dst).toEqual({
      ip: HOST,
      port: 40000,
    })
  })

  it('返事は reply の向きに当たり、宛先がコンテナーに戻る', () => {
    const entry = masquerade([], { src: A, dst: SERVER }, HOST)
    const found = match([entry], { src: SERVER, dst: { ip: HOST, port: 40000 } })
    expect(found?.direction).toBe('reply')
    expect(found === null ? null : translate(found)).toEqual({ src: SERVER, dst: A })
    // 元の向きのパケットは、送信元が書き換わる
    const out = match([entry], { src: A, dst: SERVER })
    expect(out === null ? null : translate(out)).toEqual({
      src: { ip: HOST, port: 40000 },
      dst: SERVER,
    })
  })
})

describe('dnat', () => {
  const published: Tuple = { src: CLIENT, dst: { ip: HOST, port: 8080 } }
  const container = { ip: '172.17.0.2', port: 80 }

  it('宛先だけを書き換え、送信元（外のクライアント）は変えない', () => {
    const entry = dnat(published, container)
    const found = match([entry], published)
    expect(found === null ? null : translate(found)).toEqual({ src: CLIENT, dst: container })
  })

  it('コンテナーの返事は、送信元が公開したポートに戻る', () => {
    const entry = dnat(published, container)
    const found = match([entry], { src: container, dst: CLIENT })
    expect(found?.direction).toBe('reply')
    expect(found === null ? null : translate(found)).toEqual({
      src: { ip: HOST, port: 8080 },
      dst: CLIENT,
    })
  })
})

describe('untranslated', () => {
  it('reply は original の逆で、変換しても組は変わらない', () => {
    const original: Tuple = { src: CLIENT, dst: { ip: HOST, port: 80 } }
    const entry = untranslated(original)
    expect(conntrackRow(entry)[2]).toBe('198.51.100.10:80 → 203.0.113.80:50000')
    const found = match([entry], original)
    expect(found === null ? null : translate(found)).toEqual(original)
  })

  it('どの記録にも当たらなければ null', () => {
    expect(match([], { src: A, dst: SERVER })).toBeNull()
  })
})

describe('nextState', () => {
  it('SYN → SYN, ACK → ACK で ESTABLISHED、RST で CLOSE', () => {
    expect(nextState('SYN_SENT', 'SYN, ACK', 'reply')).toBe('SYN_RECV')
    expect(nextState('SYN_RECV', 'ACK', 'original')).toBe('ESTABLISHED')
    expect(nextState('SYN_SENT', 'RST, ACK', 'reply')).toBe('CLOSE')
  })

  it('向きが違えば変わらない', () => {
    expect(nextState('SYN_SENT', 'SYN, ACK', 'original')).toBe('SYN_SENT')
    expect(nextState('SYN_RECV', 'ACK', 'reply')).toBe('SYN_RECV')
  })
})
