// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { dhcpScenario, type DhcpOptions } from './scenario'

const handle = toScenarioHandle(dhcpScenario)
const defaults: DhcpOptions = { flow: 'init', serverReply: 'ack', discoverLost: false }

function build(overrides: Partial<DhcpOptions> = {}): readonly Step[] {
  return dhcpScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** メッセージに入っているオプションの番号 */
function optionCodes(message: Message | undefined): number[] {
  return (message?.fields ?? []).flatMap((candidate) => {
    const match = /^Option (\d+) /.exec(candidate.name)
    return match === null ? [] : [Number(match[1])]
  })
}

function states(steps: readonly Step[]) {
  return steps.map(
    (_, index) => deriveState(dhcpScenario.actors, steps, index).actorStates.pc?.values.state,
  )
}

function finalPc(steps: readonly Step[]) {
  const derived = deriveState(dhcpScenario.actors, steps, steps.length - 1)
  const values = derived.actorStates.pc?.values
  const leases = derived.actorStates.dhcp?.values.leases
  return {
    state: values?.state,
    address: values?.address,
    leases: typeof leases === 'object' ? leases.rows : [],
    elapsedMs: derived.elapsedMs,
  }
}

describe('dhcpScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(
      handle.resolve({ flow: 'renew', serverReply: 'nak', discoverLost: '1' }).options,
    ).toEqual({ flow: 'renew', serverReply: 'nak', discoverLost: true })
    expect(handle.resolve({ flow: 'release', serverReply: 'maybe' }).options).toEqual(defaults)
  })

  describe('初めてつなぐ（RFC 2131 §3.1）', () => {
    const steps = build()

    it('DISCOVER → OFFER → REQUEST → ACK で、状態は INIT → SELECTING → REQUESTING → BOUND', () => {
      expect(messages(steps).map((m) => [m.label, m.from, m.to])).toEqual([
        ['DHCPDISCOVER', 'pc', 'dhcp'],
        ['DHCPOFFER', 'dhcp', 'pc'],
        ['DHCPREQUEST', 'pc', 'dhcp'],
        ['DHCPACK', 'dhcp', 'pc'],
      ])
      expect(states(steps)).toEqual([
        'INIT',
        'SELECTING',
        'SELECTING',
        'REQUESTING',
        'REQUESTING',
        'BOUND',
      ])
      expect(finalPc(steps)).toEqual({
        state: 'BOUND',
        address: '192.168.1.10/24',
        leases: [['192.168.1.10', '00:00:5e:00:53:0a', 'BOUND', 'in 3600 s']],
        elapsedMs: 0,
      })
    })

    it('アドレスがない間は 0.0.0.0:68 から 255.255.255.255:67 へ。xid はすべて同じ', () => {
      const [discover, offer, request, ack] = messages(steps)
      expect([discover, request].map((m) => field(m, 'IP Src → Dst'))).toEqual([
        '0.0.0.0 → 255.255.255.255',
        '0.0.0.0 → 255.255.255.255',
      ])
      expect([offer, ack].map((m) => field(m, 'IP Src → Dst'))).toEqual([
        '192.168.1.1 → 255.255.255.255',
        '192.168.1.1 → 255.255.255.255',
      ])
      expect(messages(steps).map((m) => field(m, 'UDP port'))).toEqual([
        '68 → 67',
        '67 → 68',
        '68 → 67',
        '67 → 68',
      ])
      expect(new Set(messages(steps).map((m) => field(m, 'xid')))).toEqual(new Set(['0x1234abcd']))
      expect(field(offer, 'yiaddr')).toBe('192.168.1.10')
      expect(field(discover, 'flags')).toBe('0x8000 (BROADCAST)')
    })

    it('各メッセージのオプション（RFC 2131 §4.3.1、§4.3.2 SELECTING）', () => {
      const [discover, offer, request, ack] = messages(steps)
      expect(optionCodes(discover)).toEqual([53, 61, 55])
      expect(optionCodes(offer)).toEqual([53, 54, 51, 58, 59, 1, 3, 6])
      expect(optionCodes(request)).toEqual([53, 61, 50, 54, 55])
      expect(optionCodes(ack)).toEqual([53, 54, 51, 58, 59, 1, 3, 6])
      expect(field(offer, 'Option 51 (Lease time)')).toBe('3600 s')
      expect(field(offer, 'Option 58 (Renewal time (T1))')).toBe('1800 s')
      expect(field(offer, 'Option 59 (Rebinding time (T2))')).toBe('3150 s')
      expect(field(request, 'Option 50 (Requested IP address)')).toBe('192.168.1.10')
      expect(field(request, 'Option 54 (Server identifier)')).toBe('192.168.1.1')
    })
  })

  it('DISCOVER がロスすると約 4 秒後に同じ xid で再送する（RFC 2131 §4.1）', () => {
    const steps = build({ discoverLost: true })
    const [lost, retransmit] = messages(steps)
    expect([lost?.status, retransmit?.status, retransmit?.retransmitOf]).toEqual([
      'lost',
      'delivered',
      'discover',
    ])
    expect(field(retransmit, 'secs')).toBe('4')
    expect(field(retransmit, 'xid')).toBe('0x1234abcd')
    expect(finalPc(steps).elapsedMs).toBe(4000)
  })

  describe('リースの更新（RFC 2131 §4.3.2 RENEWING、§4.4.5）', () => {
    const steps = build({ flow: 'renew' })

    it('T1（1800 秒）でユニキャストの REQUEST を送り、オプション 50・54 を入れない', () => {
      const [request, ack] = messages(steps)
      expect(field(request, 'IP Src → Dst')).toBe('192.168.1.10 → 192.168.1.1')
      expect(field(request, 'Eth Dst')).toBe('00:00:5e:00:53:01')
      expect(field(request, 'ciaddr')).toBe('192.168.1.10')
      expect(field(request, 'flags')).toBe('0x0000')
      expect(optionCodes(request)).toEqual([53, 61])
      expect(field(ack, 'IP Src → Dst')).toBe('192.168.1.1 → 192.168.1.10')
      expect(states(steps)).toEqual(['BOUND', 'RENEWING', 'RENEWING', 'RENEWING', 'BOUND'])
      expect(finalPc(steps).elapsedMs).toBe(1_800_000)
    })

    it('NAK なら（NAK は常にブロードキャスト）アドレスを捨てて INIT に戻る', () => {
      const nak = build({ flow: 'renew', serverReply: 'nak' })
      const reply = messages(nak).at(-1)
      expect([reply?.label, field(reply, 'IP Src → Dst')]).toEqual([
        'DHCPNAK',
        '192.168.1.1 → 255.255.255.255',
      ])
      expect(optionCodes(reply)).toEqual([53, 54])
      expect(finalPc(nak)).toMatchObject({
        state: 'INIT',
        address: '-',
        leases: [['192.168.1.10', '00:00:5e:00:53:14', 'BOUND', 'in 3600 s']],
      })
    })
  })

  describe('再起動（RFC 2131 §3.2、§4.3.2 INIT-REBOOT）', () => {
    it('覚えていたアドレスをオプション 50 に入れてブロードキャストし、54 は入れない', () => {
      const steps = build({ flow: 'reboot' })
      const [request] = messages(steps)
      expect(field(request, 'IP Src → Dst')).toBe('0.0.0.0 → 255.255.255.255')
      expect(optionCodes(request)).toEqual([53, 61, 50, 55])
      expect(states(steps)).toEqual(['INIT-REBOOT', 'REBOOTING', 'REBOOTING', 'BOUND'])
    })

    it('NAK なら INIT からやり直す', () => {
      const steps = build({ flow: 'reboot', serverReply: 'nak' })
      expect(steps.map((step) => step.id)).toEqual(['init-reboot', 'request', 'nak', 'restart'])
      expect(finalPc(steps).state).toBe('INIT')
    })
  })

  it('DISCOVER のロスは、初めてつなぐとき以外は影響しない', () => {
    expect(build({ flow: 'renew', discoverLost: true })).toEqual(build({ flow: 'renew' }))
    expect(build({ flow: 'reboot', discoverLost: true })).toEqual(build({ flow: 'reboot' }))
  })
})
