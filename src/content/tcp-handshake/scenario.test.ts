// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { tcpHandshakeScenario, type TcpOptions } from './scenario'

const handle = toScenarioHandle(tcpHandshakeScenario)
const defaults: TcpOptions = { synLoss: 'none', synAckLost: false, serverPort: 'open' }

function build(overrides: Partial<TcpOptions> = {}): readonly Step[] {
  return tcpHandshakeScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function finalState(steps: readonly Step[]) {
  const derived = deriveState(tcpHandshakeScenario.actors, steps, steps.length - 1)
  return {
    client: derived.actorStates.client?.values,
    server: derived.actorStates.server?.values,
    elapsedMs: derived.elapsedMs,
  }
}

describe('tcpHandshakeScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(
      handle.resolve({ synLoss: 'twice', synAckLost: '1', serverPort: 'closed' }).options,
    ).toEqual({
      synLoss: 'twice',
      synAckLost: true,
      serverPort: 'closed',
    })
    expect(handle.resolve({ synLoss: 'many', serverPort: '443' }).options).toEqual(defaults)
  })

  describe('正常系（RFC 9293 §3.5）', () => {
    const steps = build()

    it('LISTEN → SYN → SYN, ACK → ACK → ESTABLISHED の順に進む', () => {
      expect(steps.map((step) => step.id)).toEqual([
        'listen',
        'syn',
        'syn-ack',
        'ack',
        'established',
      ])
      expect(messages(steps).map((m) => [m.label, m.from, m.to, m.status])).toEqual([
        ['SYN', 'client', 'server', 'delivered'],
        ['SYN, ACK', 'server', 'client', 'delivered'],
        ['ACK', 'client', 'server', 'delivered'],
      ])
    })

    it('シーケンス番号と確認応答番号', () => {
      const [syn, synAck, ack] = messages(steps)
      expect([field(syn, 'Seq'), field(syn, 'Ack')]).toEqual(['1000', '0'])
      expect([field(synAck, 'Seq'), field(synAck, 'Ack')]).toEqual(['5000', '1001'])
      expect([field(ack, 'Seq'), field(ack, 'Ack')]).toEqual(['1001', '5001'])
    })

    it('両者の状態と SND.NXT / RCV.NXT', () => {
      expect(finalState(steps)).toEqual({
        client: { state: 'ESTABLISHED', 'SND.NXT': '1001', 'RCV.NXT': '5001' },
        server: { state: 'ESTABLISHED', 'SND.NXT': '5001', 'RCV.NXT': '1001' },
        elapsedMs: 0,
      })
    })

    it('状態遷移（RFC 9293 §3.3.2）', () => {
      const clientStates = steps.map(
        (_, i) =>
          deriveState(tcpHandshakeScenario.actors, steps, i).actorStates.client?.values.state,
      )
      const serverStates = steps.map(
        (_, i) =>
          deriveState(tcpHandshakeScenario.actors, steps, i).actorStates.server?.values.state,
      )
      expect(clientStates).toEqual(['CLOSED', 'SYN-SENT', 'SYN-SENT', 'ESTABLISHED', 'ESTABLISHED'])
      expect(serverStates).toEqual([
        'LISTEN',
        'LISTEN',
        'SYN-RECEIVED',
        'SYN-RECEIVED',
        'ESTABLISHED',
      ])
    })

    it('SND.NXT / RCV.NXT が更新されるステップ（RFC 9293 §3.10.1, §3.10.7.2, §3.10.7.3）', () => {
      const at = (actor: 'client' | 'server', key: string) =>
        steps.map(
          (_, i) =>
            deriveState(tcpHandshakeScenario.actors, steps, i).actorStates[actor]?.values[key],
        )
      // ステップ: listen, syn, syn-ack, ack, established
      expect(at('client', 'SND.NXT')).toEqual(['-', '1001', '1001', '1001', '1001'])
      expect(at('client', 'RCV.NXT')).toEqual(['-', '-', '-', '5001', '5001'])
      expect(at('server', 'SND.NXT')).toEqual(['-', '-', '5001', '5001', '5001'])
      expect(at('server', 'RCV.NXT')).toEqual(['-', '-', '1001', '1001', '1001'])
    })
  })

  describe('SYN のロス（RFC 6298 §2.1, §5.5）', () => {
    it('1 回ロスすると、1 秒後に同じシーケンス番号で再送する', () => {
      const steps = build({ synLoss: 'once' })
      const syns = messages(steps).filter((m) => m.label === 'SYN')
      expect(syns.map((m) => [m.id, m.status, m.retransmitOf, field(m, 'Seq')])).toEqual([
        ['syn', 'lost', undefined, '1000'],
        ['syn-rtx-1', 'delivered', 'syn', '1000'],
      ])
      expect(finalState(steps).elapsedMs).toBe(1000)
      expect(finalState(steps).client?.state).toBe('ESTABLISHED')
    })

    it('2 回ロスすると、RTO が 1 秒 → 2 秒と倍になる', () => {
      const steps = build({ synLoss: 'twice' })
      const timers = steps.flatMap((step) =>
        step.events.flatMap((event) => (event.kind === 'timer' ? [event.durationMs] : [])),
      )
      expect(timers).toEqual([1000, 2000])
      expect(
        messages(steps)
          .filter((m) => m.label === 'SYN')
          .map((m) => m.status),
      ).toEqual(['lost', 'lost', 'delivered'])
      expect(finalState(steps).elapsedMs).toBe(3000)
    })
  })

  describe('SYN, ACK のロス（RFC 9293 §3.8.1）', () => {
    it('サーバーが 1 秒後に SYN, ACK を再送し、接続は確立する', () => {
      const steps = build({ synAckLost: true })
      const synAcks = messages(steps).filter((m) => m.label === 'SYN, ACK')
      expect(synAcks.map((m) => [m.status, m.retransmitOf, field(m, 'Ack')])).toEqual([
        ['lost', undefined, '1001'],
        ['delivered', 'syn-ack', '1001'],
      ])
      const timer = steps.flatMap((step) => step.events).find((event) => event.kind === 'timer')
      expect(timer).toMatchObject({ actorId: 'server', name: 'RTO', durationMs: 1000 })
      expect(finalState(steps).server?.state).toBe('ESTABLISHED')
    })
  })

  describe('ポートが閉じている（RFC 9293 §3.10.7.1, §3.10.7.3）', () => {
    it('サーバーは RST, ACK（Seq 0、Ack = ISS + 1）を返し、クライアントは CLOSED に戻る', () => {
      const steps = build({ serverPort: 'closed' })
      expect(steps.map((step) => step.id)).toEqual(['no-listener', 'syn', 'rst', 'reset'])
      const [syn, rst] = messages(steps)
      expect(syn?.status).toBe('rejected')
      expect([rst?.label, field(rst, 'Seq'), field(rst, 'Ack')]).toEqual(['RST, ACK', '0', '1001'])
      expect(finalState(steps)).toMatchObject({
        client: { state: 'CLOSED', 'SND.NXT': '-' },
        server: { state: 'CLOSED' },
      })
    })

    it('SYN, ACK のロスは影響しない', () => {
      expect(build({ serverPort: 'closed', synAckLost: true })).toEqual(
        build({ serverPort: 'closed' }),
      )
    })

    it('SYN のロスと組み合わせると、再送した SYN にリセットが返る', () => {
      const steps = build({ serverPort: 'closed', synLoss: 'once' })
      expect(messages(steps).map((m) => [m.label, m.status])).toEqual([
        ['SYN', 'lost'],
        ['SYN', 'rejected'],
        ['RST, ACK', 'delivered'],
      ])
    })
  })
})
