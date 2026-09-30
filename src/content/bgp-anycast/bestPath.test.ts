// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { removeFrom, replaceFrom, selectBest, type Candidate } from './bestPath'

const VIA_A: Candidate = {
  from: 'siteA',
  peerId: '192.0.2.2',
  asPath: [64511],
  nextHop: '192.0.2.2',
}
const VIA_T: Candidate = {
  from: 'transit',
  peerId: '198.51.100.1',
  asPath: [64500, 64511],
  nextHop: '198.51.100.1',
}

describe('selectBest（RFC 4271 §9.1.2.2）', () => {
  it('AS_PATH の短い方を選ぶ', () => {
    expect(selectBest([VIA_T, VIA_A], 64496)).toEqual({ best: VIA_A, reason: 'asPathLength' })
  })

  it('1 つだけならそれ。なければ null', () => {
    expect(selectBest([VIA_T], 64496)).toEqual({ best: VIA_T, reason: 'only' })
    expect(selectBest([], 64496)).toBeNull()
  })

  it('同じ長さなら BGP Identifier の小さい方', () => {
    const longA = { ...VIA_A, asPath: [64511, 64511] }
    expect(selectBest([VIA_T, longA], 64496)).toEqual({ best: longA, reason: 'bgpIdentifier' })
  })

  it('自分の AS がある経路は使わない', () => {
    expect(selectBest([VIA_T], 64511)).toBeNull()
  })

  it('プリペンドした経路が来ると置き換わり、選ぶ経路が変わる', () => {
    const prepended = { ...VIA_A, asPath: [64511, 64511, 64511] }
    const candidates = replaceFrom([VIA_A, VIA_T], prepended)
    expect(candidates).toHaveLength(2)
    expect(selectBest(candidates, 64496)).toEqual({ best: VIA_T, reason: 'asPathLength' })
  })

  it('取り下げでその相手の経路が消える', () => {
    expect(removeFrom([VIA_A, VIA_T], 'siteA')).toEqual([VIA_T])
  })
})
