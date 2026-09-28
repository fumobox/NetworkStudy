// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { priorityOf } from './ice'
import {
  CHANNEL,
  natTraversalScenario,
  PERMISSION_LEFT_MS,
  REFRESH_MS,
  RELEASE_MS,
  type NatTraversalOptions,
} from './scenario'

const handle = toScenarioHandle(natTraversalScenario)
const defaults: NatTraversalOptions = { network: 'independent', permissionExpires: false }
const NETWORKS = ['independent', 'symmetric', 'udpBlocked'] as const

function build(overrides: Partial<NatTraversalOptions> = {}): readonly Step[] {
  return natTraversalScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function stepFlow(steps: readonly Step[], stepId: string) {
  const step = steps.find((candidate) => candidate.id === stepId)
  return (step?.events ?? []).flatMap((event) =>
    event.kind === 'message'
      ? [
          `${event.message.from}→${event.message.to}${event.message.status === 'delivered' ? '' : ` ${event.message.status}`}`,
        ]
      : [],
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

const rows = (value: StateValue | undefined) => (typeof value === 'object' ? value.rows : null)

function final(steps: readonly Step[]) {
  const state = deriveState(natTraversalScenario.actors, steps, steps.length - 1)
  const values = (id: string) => state.actorStates[id]?.values
  return {
    elapsedMs: state.elapsedMs,
    aSelected: values('pcA')?.selected,
    bSelected: values('pcB')?.selected,
    natA: rows(values('natA')?.nat),
    natB: rows(values('natB')?.nat),
  }
}

describe('natTraversalScenario', () => {
  it('すべてのオプションの組み合わせ（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ network: 'udpBlocked', permissionExpires: 'true' }).options).toEqual({
      network: 'udpBlocked',
      permissionExpires: true,
    })
    expect(handle.resolve({ network: 'cone', permissionExpires: '?' }).options).toEqual(defaults)
  })

  describe('候補を集める（STUN と TURN）', () => {
    it('Binding の応答の XOR-MAPPED-ADDRESS は、NAT の表の外側のアドレス', () => {
      const all = messages(build())
      const response = all.find((m) => m.label === 'Binding Success' && m.from === 'natA')
      expect(field(response, 'XOR-MAPPED-ADDRESS')).toBe(
        '00 01 bd 53 ea 12 d5 47 → 203.0.113.5:40001',
      )
      expect(field(response, 'Message Type')).toBe('0x0101 (Binding Success Response)')
      expect(field(response, 'Message Length')).toBe('12')
      // 応答は要求と同じトランザクション ID
      const request = all.find((m) => m.label === 'Binding Request' && m.from === 'pcA')
      expect(field(response, 'Transaction ID')).toBe(field(request, 'Transaction ID'))
    })

    it('Allocate は 401 の後に、新しいトランザクション ID で資格情報を付けて送り直す', () => {
      const all = messages(build()).filter((m) => m.from === 'pcA' || m.to === 'pcA')
      const [first, error, retry, success] = [
        'Allocate Request',
        'Allocate Error 401',
        'Allocate Request (credentials)',
        'Allocate Success',
      ].map((label) => all.find((m) => m.label === label))
      expect(field(error, 'ERROR-CODE')).toBe('401 (Unauthenticated)')
      expect(field(error, 'Transaction ID')).toBe(field(first, 'Transaction ID'))
      expect(field(retry, 'Transaction ID')).not.toBe(field(first, 'Transaction ID'))
      expect(field(retry, 'USERNAME')).toBe('alice')
      expect(field(retry, 'Message Length')).toBe('128')
      expect(field(error, 'Message Length')).toBe('88')
      expect(field(success, 'XOR-RELAYED-ADDRESS')).toBe(
        '00 01 f7 ca e7 21 c0 41 → 198.51.100.3:55000',
      )
      expect(field(success, 'LIFETIME')).toBe('600 (seconds)')
    })

    it('許可は IP アドレスだけ（ポートは見ない）で、300 秒', () => {
      const steps = build()
      const index = steps.findIndex((step) => step.id === 'permission')
      const state = deriveState(natTraversalScenario.actors, steps, index).actorStates.server
        ?.values
      expect(rows(state?.permissions)).toEqual([
        ['10.0.0.20', '300 s'],
        ['192.0.2.77', '300 s'],
      ])
    })
  })

  describe('ICE のチェック', () => {
    it('チェックは PRIORITY（peer reflexive）、FINGERPRINT、相手の ufrag:自分の ufrag を持つ', () => {
      const checks = messages(build()).filter((m) =>
        field(m, 'Message Type')?.includes('ICE check'),
      )
      expect(checks.length).toBeGreaterThan(0)
      for (const check of checks) {
        expect(field(check, 'PRIORITY')).toBe(String(priorityOf('prflx')))
        expect(field(check, 'FINGERPRINT')).toBeDefined()
        const controlling = field(check, 'ICE-CONTROLLING') !== undefined
        expect(field(check, 'USERNAME')).toBe(controlling ? 'bxkW:EsAw' : 'EsAw:bxkW')
        if (field(check, 'USE-CANDIDATE') !== undefined) expect(controlling).toBe(true)
      }
    })

    it('Send と Data の通知には MESSAGE-INTEGRITY がない', () => {
      for (const network of NETWORKS) {
        const indications = messages(build({ network })).filter((m) =>
          field(m, 'Message Type')?.includes('indication'),
        )
        for (const indication of indications) {
          expect(field(indication, 'MESSAGE-INTEGRITY')).toBeUndefined()
          expect(field(indication, 'MESSAGE-INTEGRITY-SHA256')).toBeUndefined()
        }
      }
    })
  })

  describe('宛先によらない対応づけ（ホールパンチング）', () => {
    it('PC A の最初のチェックは NAT B で捨てられ、PC B のチェックで道が開く', () => {
      const steps = build()
      expect(stepFlow(steps, 'a-check')).toEqual(['pcA→natA', 'natA→natB rejected'])
      expect(stepFlow(steps, 'b-check')).toEqual(['pcB→natB', 'natB→natA', 'natA→pcA'])
      expect(stepFlow(steps, 'a-triggered')).toEqual(['pcA→natA', 'natA→natB', 'natB→pcB'])
    })

    it('チェックの途中でチェックを受け取ったペアは Waiting に戻し、トリガーされたチェックで In-Progress', () => {
      const steps = build()
      const pairState = (stepId: string) => {
        const index = steps.findIndex((step) => step.id === stepId)
        const value = deriveState(natTraversalScenario.actors, steps, index).actorStates.pcA?.values
          .checklist
        return rows(value)?.find((row) => row[1] === '192.0.2.77:60001')?.[2]
      }
      expect(['a-check', 'a-response', 'a-triggered', 'b-response'].map(pairState)).toEqual([
        'In-Progress',
        'Waiting',
        'In-Progress',
        'Succeeded',
      ])
    })

    it('直接のペアを選び、NAT の外側のポートは 1 つずつ。使わない中継は 3 秒後に放す', () => {
      const state = final(build())
      expect(state.aSelected).toBe('203.0.113.5:40001 ↔ 192.0.2.77:60001')
      expect(state.bSelected).toBe('192.0.2.77:60001 ↔ 203.0.113.5:40001')
      expect(new Set(state.natA?.map((row) => row[2]))).toEqual(new Set(['203.0.113.5:40001']))
      expect(new Set(state.natB?.map((row) => row[2]))).toEqual(new Set(['192.0.2.77:60001']))
      expect(state.elapsedMs).toBe(RELEASE_MS)
      const release = messages(build()).find((m) => m.label === 'Refresh (LIFETIME 0)')
      expect(field(release, 'LIFETIME')).toBe('0 (delete)')
    })

    it('許可の更新を忘れても、直接のときは変わらない', () => {
      expect(build({ permissionExpires: true })).toEqual(build())
    })
  })

  describe('もしも', () => {
    it('NAT B がアドレスとポートごとの対応づけ: 宛先ごとに新しいポートになり、中継のペアが選ばれる', () => {
      const steps = build({ network: 'symmetric' })
      expect(stepFlow(steps, 'b-check')).toEqual(['pcB→natB', 'natB→natA rejected'])
      const state = final(steps)
      expect(new Set(state.natB?.map((row) => row[2]))).toEqual(
        new Set(['192.0.2.77:60001', '192.0.2.77:60002', '192.0.2.77:60003']),
      )
      expect(state.aSelected).toBe('198.51.100.3:55000 ↔ 192.0.2.77:60003')
      // PC A は知らない送信元から peer reflexive の相手の候補を得る
      const index = steps.findIndex((step) => step.id === 'b-check-relay')
      const remote = deriveState(natTraversalScenario.actors, steps, index).actorStates.pcA?.values
        .remote
      expect(rows(remote)?.at(-1)).toEqual([
        'prflx',
        '192.0.2.77:60003',
        String(priorityOf('prflx')),
      ])
      expect(state.elapsedMs).toBe(REFRESH_MS)
    })

    it('同時に進む別々のチェックは、別のトランザクション ID を使う', () => {
      const all = messages(build({ network: 'symmetric' }))
      const direct = all.find((m) => m.id.startsWith('b-check-') && m.from === 'pcB')
      const relay = all.find((m) => m.id.startsWith('b-check-relay') && m.from === 'pcB')
      expect(field(direct, 'Transaction ID')).not.toBe(field(relay, 'Transaction ID'))
    })

    it('ChannelData のヘッダーは 4 バイト、チャネル番号は 0x4000〜0x4FFF', () => {
      const all = messages(build({ network: 'symmetric' }))
      const channelData = all.find((m) => m.label === 'ChannelData 0x4000 (SRTP)')
      expect(field(channelData, 'ChannelData header')).toBe('40 00 00 7a')
      expect(CHANNEL).toBeGreaterThanOrEqual(0x4000)
      expect(CHANNEL).toBeLessThanOrEqual(0x4fff)
    })

    it('UDP が止められる: STUN は届かず、TURN を TLS で使い、PC A とサーバーの間はすべて暗号化', () => {
      const steps = build({ network: 'udpBlocked' })
      expect(stepFlow(steps, 'a-binding-blocked')).toEqual(['pcA→natA rejected'])
      const aServer = messages(steps).filter(
        (m) =>
          (m.from === 'natA' && m.to === 'server') ||
          (m.from === 'server' && m.to === 'natA') ||
          (m.from === 'pcA' && m.to === 'natA' && field(m, 'Transport') === 'TLS over TCP'),
      )
      expect(aServer.length).toBeGreaterThan(0)
      expect(aServer.every((m) => m.encrypted === true)).toBe(true)
      // UDP で NAT A を越えるものはない
      expect(
        messages(steps).some((m) => m.from === 'natA' && field(m, 'Transport') === 'UDP'),
      ).toBe(false)
      const channelData = messages(steps).find((m) => m.label === 'ChannelData 0x4000 (SRTP)')
      expect(field(channelData, 'Padding')).toBe('2 bytes (to 128)')
      expect(final(steps).aSelected).toBe('198.51.100.3:55000 ↔ 192.0.2.77:60001')
    })

    it('許可の更新を忘れる: 割り当てとチャネルは残っても、PC B からのデータは捨てられる', () => {
      for (const network of ['symmetric', 'udpBlocked'] as const) {
        const steps = build({ network, permissionExpires: true })
        expect(stepFlow(steps, 'dropped')).toEqual(['pcB→natB', 'natB→server rejected'])
        const index = steps.findIndex((step) => step.id === 'permission-expired')
        const server = deriveState(natTraversalScenario.actors, steps, index).actorStates.server
          ?.values
        expect(rows(server?.permissions)).toEqual([])
        expect(rows(server?.channels)?.length).toBe(1)
        expect(final(steps).elapsedMs).toBe(REFRESH_MS + PERMISSION_LEFT_MS)
      }
    })
  })

  it('アドレスは文書用（RFC 5737）とプライベート（RFC 1918）だけ', () => {
    const allowed = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|10\.|192\.168\.)/
    for (const network of NETWORKS) {
      for (const message of messages(build({ network }))) {
        const addresses = (field(message, 'IP Src → Dst') ?? '').match(/\d+\.\d+\.\d+\.\d+/g) ?? []
        for (const address of addresses) expect(address).toMatch(allowed)
      }
    }
  })

  it('ラベルは短い', () => {
    for (const network of NETWORKS) {
      for (const permissionExpires of [false, true]) {
        expect(
          Math.max(...messages(build({ network, permissionExpires })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
