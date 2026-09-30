// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyArpPacket, type ArpEntry, type ArpPacket } from './arpCache'

const PC_A = '192.168.1.10'
const GATEWAY: ArpEntry = { ip: '192.168.1.1', mac: '00:00:5e:00:53:01', type: 'dynamic' }
const FORGED: ArpPacket = {
  oper: 2,
  sha: '00:00:5e:00:53:42',
  spa: '192.168.1.1',
  tha: '00:00:5e:00:53:0a',
  tpa: PC_A,
}

describe('applyArpPacket（RFC 826）', () => {
  it('頼んでいない応答でも、送信元の IP アドレスの行があれば書き換える', () => {
    expect(applyArpPacket([GATEWAY], FORGED, PC_A)).toEqual({
      cache: [{ ...GATEWAY, mac: '00:00:5e:00:53:42' }],
      action: 'updated',
    })
  })

  it('要求でも同じく書き換える（操作を見る前に merge する）', () => {
    const request: ArpPacket = { ...FORGED, oper: 1, tha: '00:00:00:00:00:00', tpa: '192.168.1.20' }
    expect(applyArpPacket([GATEWAY], request, PC_A).action).toBe('updated')
  })

  it('同じ MAC アドレスなら変わらない', () => {
    const genuine: ArpPacket = { ...FORGED, sha: GATEWAY.mac }
    expect(applyArpPacket([GATEWAY], genuine, PC_A)).toEqual({
      cache: [GATEWAY],
      action: 'refreshed',
    })
  })

  it('行がなければ、自分が対象のときだけ加える', () => {
    expect(applyArpPacket([], FORGED, PC_A)).toEqual({
      cache: [{ ip: '192.168.1.1', mac: '00:00:5e:00:53:42', type: 'dynamic' }],
      action: 'added',
    })
    expect(applyArpPacket([], FORGED, '192.168.1.20')).toEqual({ cache: [], action: 'notTarget' })
  })

  it('静的なエントリーは書き換えない', () => {
    const fixed: ArpEntry = { ...GATEWAY, type: 'static' }
    expect(applyArpPacket([fixed], FORGED, PC_A)).toEqual({ cache: [fixed], action: 'static' })
  })
})
