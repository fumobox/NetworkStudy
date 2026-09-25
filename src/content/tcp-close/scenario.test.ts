// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { tcpCloseScenario, type TcpCloseOptions } from './scenario'

const handle = toScenarioHandle(tcpCloseScenario)
const defaults: TcpCloseOptions = { closeMode: 'normal', lastAckLost: false }

function build(overrides: Partial<TcpCloseOptions> = {}): readonly Step[] {
  return tcpCloseScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** 各メッセージの [ラベル, 送信元, Seq, Ack, 状態] */
function segments(steps: readonly Step[]) {
  return messages(steps).map((message) => [
    message.label,
    message.from,
    field(message, 'Seq'),
    field(message, 'Ack'),
    message.status,
  ])
}

/** ステップごとの [クライアントの状態, サーバーの状態] */
function stateHistory(steps: readonly Step[]) {
  return steps.map((_, index) => {
    const derived = deriveState(tcpCloseScenario.actors, steps, index)
    return [derived.actorStates.client?.values.state, derived.actorStates.server?.values.state]
  })
}

/** ステップごとの [クライアントの SND.NXT, RCV.NXT, サーバーの SND.NXT, RCV.NXT]（状態パネルに出る値） */
function sequenceHistory(steps: readonly Step[]) {
  return steps.map((_, index) => {
    const { client, server } = deriveState(tcpCloseScenario.actors, steps, index).actorStates
    return [
      client?.values['SND.NXT'],
      client?.values['RCV.NXT'],
      server?.values['SND.NXT'],
      server?.values['RCV.NXT'],
    ]
  })
}

function elapsedMs(steps: readonly Step[]): number {
  return deriveState(tcpCloseScenario.actors, steps, steps.length - 1).elapsedMs
}

describe('tcpCloseScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ closeMode: 'abort', lastAckLost: '1' }).options).toEqual({
      closeMode: 'abort',
      lastAckLost: true,
    })
    expect(handle.resolve({ closeMode: 'half', lastAckLost: 'maybe' }).options).toEqual(defaults)
  })

  describe('クライアントが先に閉じる（RFC 9293 §3.6 Figure 12）', () => {
    const steps = build()

    it('FIN → ACK → FIN → ACK の順に送り、FIN はシーケンス番号を 1 つ消費する', () => {
      expect(segments(steps)).toEqual([
        ['FIN, ACK', 'client', '1001', '5001', 'delivered'],
        ['ACK', 'server', '5001', '1002', 'delivered'],
        ['FIN, ACK', 'server', '5001', '1002', 'delivered'],
        ['ACK', 'client', '1002', '5002', 'delivered'],
      ])
    })

    it('状態は FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT、サーバーは CLOSE-WAIT → LAST-ACK と進む', () => {
      expect(steps.map((step) => step.id)).toEqual([
        'established',
        'client-fin',
        'server-ack',
        'server-fin',
        'client-ack',
        'server-closed',
        'time-wait-expires',
      ])
      expect(stateHistory(steps)).toEqual([
        ['ESTABLISHED', 'ESTABLISHED'],
        ['FIN-WAIT-1', 'ESTABLISHED'],
        ['FIN-WAIT-2', 'CLOSE-WAIT'],
        ['FIN-WAIT-2', 'LAST-ACK'],
        ['TIME-WAIT', 'LAST-ACK'],
        ['TIME-WAIT', 'CLOSED'],
        ['CLOSED', 'CLOSED'],
      ])
    })

    it('状態パネルの SND.NXT と RCV.NXT は、FIN を送った側と受け取った側で 1 ずつ進む', () => {
      expect(sequenceHistory(steps)).toEqual([
        ['1001', '5001', '5001', '1001'],
        ['1002', '5001', '5001', '1001'],
        ['1002', '5001', '5001', '1002'],
        ['1002', '5001', '5002', '1002'],
        ['1002', '5002', '5002', '1002'],
        ['1002', '5002', '-', '-'],
        ['-', '-', '-', '-'],
      ])
    })

    it('TIME-WAIT は 2MSL（MSL = 2 分なので 4 分）', () => {
      const timers = steps.flatMap((step) => step.events.filter((event) => event.kind === 'timer'))
      expect(timers).toEqual([
        { kind: 'timer', actorId: 'client', name: '2MSL', durationMs: 240_000 },
      ])
      expect(elapsedMs(steps)).toBe(240_000)
    })
  })

  describe('最後の ACK のロス（RFC 9293 §3.10.7.4 の TIME-WAIT）', () => {
    const steps = build({ lastAckLost: true })

    it('サーバーが FIN を再送し、TIME-WAIT のクライアントがもう一度 ACK を返す', () => {
      expect(steps.map((step) => step.id)).toEqual([
        'established',
        'client-fin',
        'server-ack',
        'server-fin',
        'client-ack',
        'server-fin-rtx',
        'server-closed',
        'time-wait-expires',
      ])
      expect(segments(steps).slice(3)).toEqual([
        ['ACK', 'client', '1002', '5002', 'lost'],
        ['FIN, ACK', 'server', '5001', '1002', 'delivered'],
        ['ACK', 'client', '1002', '5002', 'delivered'],
      ])
      const retransmission = messages(steps).find((message) => message.id === 'server-fin-rtx-1')
      expect(retransmission?.retransmitOf).toBe('server-fin')
    })

    it('再送の間、サーバーは LAST-ACK、クライアントは TIME-WAIT のまま', () => {
      expect(stateHistory(steps).slice(4)).toEqual([
        ['TIME-WAIT', 'LAST-ACK'],
        ['TIME-WAIT', 'LAST-ACK'],
        ['TIME-WAIT', 'CLOSED'],
        ['CLOSED', 'CLOSED'],
      ])
      // RTO（1 秒）の後に、やり直した 2MSL
      expect(elapsedMs(steps)).toBe(1_000 + 240_000)
      // 再送した FIN は同じ番号なので、SND.NXT と RCV.NXT は変わらない
      expect(sequenceHistory(steps).slice(4, 6)).toEqual([
        ['1002', '5002', '5002', '1002'],
        ['1002', '5002', '5002', '1002'],
      ])
    })
  })

  describe('同時クローズ（RFC 9293 §3.6 Figure 13）', () => {
    const steps = build({ closeMode: 'simultaneous' })

    it('両者が FIN を送り、それぞれ相手の FIN を確認応答する', () => {
      expect(segments(steps)).toEqual([
        ['FIN, ACK', 'client', '1001', '5001', 'delivered'],
        ['FIN, ACK', 'server', '5001', '1001', 'delivered'],
        ['ACK', 'client', '1002', '5002', 'delivered'],
        ['ACK', 'server', '5002', '1002', 'delivered'],
      ])
    })

    it('両者が CLOSING を経て TIME-WAIT に入り、2MSL の後に CLOSED になる', () => {
      expect(stateHistory(steps)).toEqual([
        ['ESTABLISHED', 'ESTABLISHED'],
        ['FIN-WAIT-1', 'FIN-WAIT-1'],
        ['CLOSING', 'CLOSING'],
        ['TIME-WAIT', 'TIME-WAIT'],
        ['CLOSED', 'CLOSED'],
      ])
      expect(elapsedMs(steps)).toBe(240_000)
      expect(sequenceHistory(steps)).toEqual([
        ['1001', '5001', '5001', '1001'],
        ['1002', '5001', '5002', '1001'],
        ['1002', '5002', '5002', '1002'],
        ['1002', '5002', '5002', '1002'],
        ['-', '-', '-', '-'],
      ])
    })

    it('最後の ACK のロスは影響しない', () => {
      expect(build({ closeMode: 'simultaneous', lastAckLost: true })).toEqual(steps)
    })
  })

  describe('RST による中断（RFC 9293 §3.10.5 ABORT）', () => {
    const steps = build({ closeMode: 'abort' })

    it('クライアントは RST（Seq = SND.NXT）を送ってすぐ CLOSED になり、TIME-WAIT はない', () => {
      expect(segments(steps)).toEqual([['RST', 'client', '1001', undefined, 'delivered']])
      expect(stateHistory(steps)).toEqual([
        ['ESTABLISHED', 'ESTABLISHED'],
        ['CLOSED', 'ESTABLISHED'],
        ['CLOSED', 'CLOSED'],
      ])
      expect(elapsedMs(steps)).toBe(0)
      expect(sequenceHistory(steps)).toEqual([
        ['1001', '5001', '5001', '1001'],
        ['-', '-', '5001', '1001'],
        ['-', '-', '-', '-'],
      ])
    })

    it('最後の ACK のロスは影響しない', () => {
      expect(build({ closeMode: 'abort', lastAckLost: true })).toEqual(steps)
    })
  })
})
