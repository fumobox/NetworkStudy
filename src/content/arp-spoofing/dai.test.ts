// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { bindingFromAck, describeDai, inspectArp, type DaiConfig, type InspectedArp } from './dai'

const PC_A = { ip: '192.168.1.10', mac: '00:00:5e:00:53:0a' }
const CONFIG: DaiConfig = {
  trustedPorts: [2],
  bindings: [{ ip: PC_A.ip, mac: PC_A.mac, port: 1, leaseS: 3600 }],
  acl: [],
}
const FORGED: InspectedArp = { port: 3, sha: '00:00:5e:00:53:42', spa: '192.168.1.1' }
const FROM_PC_A: InspectedArp = { port: 1, sha: PC_A.mac, spa: PC_A.ip }

describe('inspectArp', () => {
  it('信頼するポートは確かめない', () => {
    const fromGateway = { port: 2, sha: '00:00:5e:00:53:01', spa: '192.168.1.1' }
    expect(inspectArp(fromGateway, CONFIG)).toEqual({ verdict: 'bypass' })
    expect(describeDai({ verdict: 'bypass' }, fromGateway)).toBe('bypass: trusted port 2')
  })

  it('束縛表にある組は通し、ない組は捨てる', () => {
    expect(inspectArp(FROM_PC_A, CONFIG)).toEqual({ verdict: 'permit', by: 'binding' })
    const result = inspectArp(FORGED, CONFIG)
    expect(result).toEqual({ verdict: 'drop', by: 'noBinding' })
    expect(describeDai(result, FORGED)).toBe(
      'drop: no binding for 192.168.1.1 ↔ 00:00:5e:00:53:42 (port 3)',
    )
  })

  it('IP アドレスが同じでも MAC アドレスが違えば捨てる', () => {
    expect(inspectArp({ ...FROM_PC_A, sha: '00:00:5e:00:53:42' }, CONFIG).verdict).toBe('drop')
  })

  it('静的な IP アドレスのホストは束縛がないので、ARP ACL で許す', () => {
    const noBinding = { ...CONFIG, bindings: [] }
    expect(inspectArp(FROM_PC_A, noBinding)).toEqual({ verdict: 'drop', by: 'noBinding' })
    const withAcl = { ...noBinding, acl: [{ action: 'permit' as const, ...PC_A }] }
    expect(inspectArp(FROM_PC_A, withAcl)).toEqual({ verdict: 'permit', by: 'acl' })
    expect(inspectArp(FORGED, withAcl).verdict).toBe('drop')
  })

  it('ACL の拒否は束縛より先に効く', () => {
    const denied = { ...CONFIG, acl: [{ action: 'deny' as const, ...PC_A }] }
    expect(inspectArp(FROM_PC_A, denied)).toEqual({ verdict: 'drop', by: 'acl' })
  })
})

describe('bindingFromAck（DHCP スヌーピング）', () => {
  const ack = { yiaddr: PC_A.ip, chaddr: PC_A.mac, leaseS: 3600 }
  it('信頼するポートからの DHCPACK で束縛を記録する', () => {
    expect(bindingFromAck(ack, 2, 1, [2])).toEqual({ ...PC_A, port: 1, leaseS: 3600 })
  })
  it('信頼しないポートからの DHCPACK は捨てる', () => {
    expect(bindingFromAck(ack, 3, 1, [2])).toBeNull()
  })
})
