// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { candidatePriority, pairPriority, priorityOf, sdpCandidate } from './ice'

describe('候補の優先度（RFC 8445 §5.1.2.1）', () => {
  it('RFC 5769 §2.1 の PRIORITY 0x6e0001ff と、RFC 8839 §4.2.6 の例', () => {
    expect(candidatePriority(110, 1, 1)).toBe(0x6e0001ff)
    expect(priorityOf('host')).toBe(2130706431)
    expect(priorityOf('srflx')).toBe(1694498815)
  })

  it('このページの 4 種類', () => {
    expect((['host', 'prflx', 'srflx', 'relay'] as const).map(priorityOf)).toEqual([
      2130706431, 1862270975, 1694498815, 16777215,
    ])
  })
})

describe('候補ペアの優先度（RFC 8445 §6.1.2.3）', () => {
  it('BigInt で計算し、両側から見た値は 1 だけ違う', () => {
    expect(pairPriority(priorityOf('host'), priorityOf('host'))).toBe(9151314442783293438n)
    expect(pairPriority(priorityOf('host'), priorityOf('srflx'))).toBe(7277816997797167103n)
    // 制御される側（PC B）から見たとき: G は PC A の候補
    expect(pairPriority(priorityOf('srflx'), priorityOf('host'))).toBe(7277816997797167102n)
    expect(pairPriority(priorityOf('relay'), priorityOf('prflx'))).toBe(72057593467502590n)
    expect(pairPriority(priorityOf('relay'), priorityOf('srflx'))).toBe(72057593131958270n)
  })
})

describe('SDP の candidate の行（RFC 8839 §5.1）', () => {
  it('srflx は raddr と rport に基底（ホスト候補）を書く', () => {
    expect(
      sdpCandidate({
        foundation: '2',
        type: 'srflx',
        ip: '203.0.113.5',
        port: 40001,
        related: { ip: '192.168.1.10', port: 49152 },
      }),
    ).toBe(
      'a=candidate:2 1 UDP 1694498815 203.0.113.5 40001 typ srflx raddr 192.168.1.10 rport 49152',
    )
  })
})
