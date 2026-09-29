// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decide, isGroupMac, learn, type FdbEntry } from './bridge'

const BRIDGE = '00:00:5e:00:53:01'
const A = '00:00:5e:00:53:02'
const B = '00:00:5e:00:53:03'
const BROADCAST = 'ff:ff:ff:ff:ff:ff'
const PORTS = ['docker0', 'vethA', 'vethB'] as const
const LOCAL: readonly FdbEntry[] = [{ mac: BRIDGE, port: 'docker0', type: 'local' }]

describe('isGroupMac', () => {
  it('ブロードキャストとマルチキャストはグループアドレス', () => {
    expect(isGroupMac(BROADCAST)).toBe(true)
    expect(isGroupMac('01:00:5e:00:00:01')).toBe(true)
    expect(isGroupMac(A)).toBe(false)
  })
})

describe('learn', () => {
  it('送信元を、受け取ったポートとともに記録する', () => {
    expect(learn(LOCAL, A, 'vethA')).toEqual([...LOCAL, { mac: A, port: 'vethA', type: 'learned' }])
  })

  it('同じポートなら変えず、別のポートに移れば書き換える', () => {
    const fdb = learn(LOCAL, A, 'vethA')
    expect(learn(fdb, A, 'vethA')).toBe(fdb)
    expect(learn(fdb, A, 'vethB')).toEqual([...LOCAL, { mac: A, port: 'vethB', type: 'learned' }])
  })

  it('グループアドレスとブリッジ自身の MAC アドレスは学習しない', () => {
    expect(learn(LOCAL, BROADCAST, 'vethA')).toBe(LOCAL)
    expect(learn(LOCAL, BRIDGE, 'vethA')).toBe(LOCAL)
  })
})

describe('decide', () => {
  const fdb = learn(learn(LOCAL, A, 'vethA'), B, 'vethB')

  it('ブロードキャストは、受け取ったポート以外のすべて（ブリッジ自身のインターフェースを含む）に流す', () => {
    expect(decide(LOCAL, BROADCAST, 'vethA', PORTS)).toEqual({
      kind: 'flood',
      ports: ['docker0', 'vethB'],
    })
  })

  it('知らないユニキャストも流す', () => {
    expect(decide(LOCAL, B, 'vethA', PORTS)).toEqual({ kind: 'flood', ports: ['docker0', 'vethB'] })
  })

  it('知っている宛先には、そのポートにだけ送る', () => {
    expect(decide(fdb, B, 'vethA', PORTS)).toEqual({ kind: 'forward', port: 'vethB' })
    expect(decide(fdb, A, 'docker0', PORTS)).toEqual({ kind: 'forward', port: 'vethA' })
  })

  it('宛先がブリッジ自身なら、ホストの IP の処理に上げる', () => {
    expect(decide(fdb, BRIDGE, 'vethA', PORTS)).toEqual({ kind: 'local' })
  })

  it('宛先が受け取ったポートの先なら送らない', () => {
    expect(decide(fdb, A, 'vethA', PORTS)).toEqual({ kind: 'filter' })
  })
})
