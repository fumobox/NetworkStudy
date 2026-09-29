// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  decide,
  learnLocal,
  learnRemote,
  multicastMac,
  type FloodTarget,
  type VtepEntry,
} from './vtep'

const A = '00:00:5e:00:53:01'
const B = '00:00:5e:00:53:02'
const BROADCAST = 'ff:ff:ff:ff:ff:ff'
const HOST2 = '198.51.100.20'
const FLOOD: FloodTarget = { kind: 'vteps', ips: [HOST2] }

describe('VTEP の学習', () => {
  it('自分のポートと、トンネルの向こうを学習する', () => {
    const fdb = learnRemote(learnLocal([], 100, A, 'vethA'), 100, B, HOST2)
    expect(fdb).toEqual([
      { vni: 100, mac: A, where: 'vethA', remote: false, type: 'local' },
      { vni: 100, mac: B, where: HOST2, remote: true, type: 'learned' },
    ])
  })

  it('同じ MAC アドレスでも、VNI が違えば別の行', () => {
    const fdb = learnRemote(learnLocal([], 100, A, 'vethA'), 200, A, HOST2)
    expect(fdb).toHaveLength(2)
    expect(decide(fdb, FLOOD, 100, A, { kind: 'port', port: 'vethX' }, ['vethA'])).toEqual({
      kind: 'local',
      port: 'vethA',
    })
    expect(decide(fdb, FLOOD, 200, A, { kind: 'port', port: 'vethC' }, ['vethC'])).toEqual({
      kind: 'encap',
      vtep: HOST2,
    })
  })

  it('グループアドレスは学習せず、静的な行は書き換えない', () => {
    expect(learnLocal([], 100, BROADCAST, 'vethA')).toEqual([])
    const fixed: readonly VtepEntry[] = [
      { vni: 100, mac: B, where: HOST2, remote: true, type: 'static' },
    ]
    expect(learnRemote(fixed, 100, B, '203.0.113.9')).toBe(fixed)
  })

  it('同じ行なら変えない', () => {
    const fdb = learnLocal([], 100, A, 'vethA')
    expect(learnLocal(fdb, 100, A, 'vethA')).toBe(fdb)
  })
})

describe('VTEP の転送', () => {
  const fdb = learnRemote(learnLocal([], 100, A, 'vethA'), 100, B, HOST2)

  it('ブロードキャストは、ほかの自分のポートと流す先へ', () => {
    expect(decide(fdb, FLOOD, 100, BROADCAST, { kind: 'port', port: 'vethA' }, ['vethA'])).toEqual({
      kind: 'flood',
      ports: [],
      remote: FLOOD,
    })
  })

  it('トンネルから受け取ったブロードキャストは、自分のポートにだけ流す（スプリットホライズン）', () => {
    expect(decide(fdb, FLOOD, 100, BROADCAST, { kind: 'tunnel' }, ['vethA'])).toEqual({
      kind: 'flood',
      ports: ['vethA'],
      remote: null,
    })
  })

  it('知っている宛先: 相手の VTEP ならカプセル化し、自分のポートならそこへ', () => {
    expect(decide(fdb, FLOOD, 100, B, { kind: 'port', port: 'vethA' }, ['vethA'])).toEqual({
      kind: 'encap',
      vtep: HOST2,
    })
    expect(decide(fdb, FLOOD, 100, A, { kind: 'tunnel' }, ['vethA'])).toEqual({
      kind: 'local',
      port: 'vethA',
    })
  })

  it('知らない宛先は、ブロードキャストと同じく流す。マルチキャストグループでも', () => {
    const group: FloodTarget = { kind: 'group', group: '233.252.0.100' }
    expect(decide([], group, 100, B, { kind: 'port', port: 'vethA' }, ['vethA'])).toEqual({
      kind: 'flood',
      ports: [],
      remote: group,
    })
  })

  it('トンネルから来て、宛先もトンネルの向こうなら送らない', () => {
    expect(decide(fdb, FLOOD, 100, B, { kind: 'tunnel' }, ['vethA'])).toEqual({ kind: 'filter' })
  })
})

describe('multicastMac（RFC 1112 §6.4）', () => {
  it('下位 23 ビットを 01:00:5e に入れる', () => {
    expect(multicastMac('233.252.0.100')).toBe('01:00:5e:7c:00:64')
    expect(multicastMac('239.1.1.1')).toBe('01:00:5e:01:01:01')
  })

  it('32 のグループが 1 つの MAC アドレスを分け合う', () => {
    expect(multicastMac('224.0.1.1')).toBe(multicastMac('224.128.1.1'))
  })
})
