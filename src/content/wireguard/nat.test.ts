// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createNat, inbound, outbound } from './nat'

const LAPTOP = '192.168.1.10:47111'
const SERVER = '192.0.2.1:51820'

describe('時間で切れる NAT の対応', () => {
  it('外へ出ると対応を作り、30 秒で切れる', () => {
    const first = outbound(createNat('203.0.113.5', 40001, 30), LAPTOP, SERVER, 0)
    expect(first.external).toBe('203.0.113.5:40001')
    expect(inbound(first.nat, '203.0.113.5:40001', 29)).toBe(LAPTOP)
    expect(inbound(first.nat, '203.0.113.5:40001', 30)).toBeNull()
  })

  it('外へ出るパケットが時間を延ばす', () => {
    const first = outbound(createNat('203.0.113.5', 40001, 30), LAPTOP, SERVER, 0)
    const again = outbound(first.nat, LAPTOP, SERVER, 10)
    expect(again.created).toBe(false)
    expect(inbound(again.nat, '203.0.113.5:40001', 39)).toBe(LAPTOP)
  })

  it('切れた後に外へ出ると、新しいポートになる', () => {
    const first = outbound(createNat('203.0.113.5', 40001, 30), LAPTOP, SERVER, 0)
    const later = outbound(first.nat, LAPTOP, SERVER, 50)
    expect(later).toMatchObject({ external: '203.0.113.5:40002', created: true })
  })
})
