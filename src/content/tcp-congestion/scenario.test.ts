// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { CWND, CWND_HISTORY, SSTHRESH, tcpCongestionScenario, type LossMode } from './scenario'

const handle = toScenarioHandle(tcpCongestionScenario)

function build(loss: LossMode): readonly Step[] {
  return tcpCongestionScenario.buildSteps({ loss })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** ステップごとの [cwnd, ssthresh]（状態パネルに出る値） */
function windowHistory(steps: readonly Step[]) {
  return steps.map((_, index) => {
    const values = deriveState(tcpCongestionScenario.actors, steps, index).actorStates.client
      ?.values
    return [values?.[CWND], values?.[SSTHRESH]]
  })
}

/** 最後のステップでの、ラウンドごとの記録（グラフの元） */
function rounds(steps: readonly Step[]) {
  const table = deriveState(tcpCongestionScenario.actors, steps, steps.length - 1).actorStates
    .client?.values[CWND_HISTORY]
  return typeof table === 'object' ? table.rows : []
}

/** 送ったセグメントと ACK の番号（フィールドの値）を順に */
function numbers(steps: readonly Step[], from: 'client' | 'server') {
  return messages(steps)
    .filter((message) => message.from === from)
    .map((message) => message.fields[0]?.value)
}

describe('tcpCongestionScenario', () => {
  it.each([
    [
      'none',
      ['1', '2–3', '4–7', '8–15', '16–24', '25–34'],
      ['2', '3–4', '5–8', '9–16', '17–25', '26–35'],
    ],
    [
      'dupack',
      ['1', '2–3', '4–7', '8–9', '10', '11–15', '10', '16–18', '19–22'],
      ['2', '3–4', '5–8', '9–10, 10 ×5 (dup)', '16', '17–19', '20–23'],
    ],
    [
      'rto',
      ['1', '2–3', '4–7', '8–15', '8', '9–10', '11–14'],
      ['2', '3–4', '5–8', '9', '10–11', '12–15'],
    ],
  ] as const)('%s: セグメントと ACK の番号', (loss, segments, acks) => {
    const steps = build(loss)
    expect(numbers(steps, 'client')).toEqual(segments)
    expect(numbers(steps, 'server')).toEqual(acks)
  })

  it('すべてのオプションで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ loss: 'rto' }).options).toEqual({ loss: 'rto' })
    expect(handle.resolve({ loss: 'burst' }).options).toEqual({ loss: 'none' })
  })

  describe('ロスなし（RFC 5681 §3.1）', () => {
    const steps = build('none')

    it('スロースタートで 1 → 2 → 4 → 8、ssthresh に達したら輻輳回避で 1 ずつ増える', () => {
      expect(rounds(steps)).toEqual([
        ['1', '1', '8', 'slow start'],
        ['2', '2', '8', 'slow start'],
        ['3', '4', '8', 'slow start'],
        ['4', '8', '8', 'congestion avoidance'],
        ['5', '9', '8', 'congestion avoidance'],
        ['6', '10', '8', 'congestion avoidance'],
      ])
      expect(windowHistory(steps).at(-1)).toEqual(['11', '8'])
    })
  })

  describe('1 つのロスと 3 つの重複 ACK（RFC 5681 §3.2）', () => {
    const steps = build('dupack')

    it('高速再送で ssthresh = FlightSize（10〜15 の 6 個）/ 2 = 3、cwnd = ssthresh + 3 = 6、回復したら cwnd = 3', () => {
      expect(steps.map((step) => step.id)).toEqual([
        'start',
        'round-1',
        'round-2',
        'round-3',
        'round-4',
        'fast-retransmit',
        'recovery-ack',
        'round-5',
        'round-6',
      ])
      expect(windowHistory(steps).slice(4)).toEqual([
        ['8', '8'],
        ['6', '3'],
        ['3', '3'],
        ['4', '3'],
        ['5', '3'],
      ])
    })

    it('セグメント 10 が失われ、その後の 5 つに重複 ACK が返り、10 を再送する', () => {
      const round4 = messages(steps.slice(4, 7))
      expect(round4.map((message) => [message.label, message.status])).toEqual([
        ['DATA #8–9 (×2)', 'delivered'],
        ['DATA #10', 'lost'],
        ['DATA #11–15 (×5)', 'delivered'],
        ['ACK ×7', 'delivered'],
        ['DATA #10', 'delivered'],
        ['ACK 16', 'delivered'],
      ])
      expect(round4[3]?.fields[0]?.value).toBe('9–10, 10 ×5 (dup)')
      expect(round4[4]?.retransmitOf).toBe('data-4-lost')
    })

    it('スロースタートには戻らず、輻輳回避を続ける', () => {
      expect(rounds(steps)).toEqual([
        ['1', '1', '8', 'slow start'],
        ['2', '2', '8', 'slow start'],
        ['3', '4', '8', 'slow start'],
        ['4', '8', '8', '3 dup ACKs'],
        ['5', '3', '3', 'congestion avoidance'],
        ['6', '4', '3', 'congestion avoidance'],
      ])
    })
  })

  describe('RTO の満了（RFC 5681 §3.1、RFC 6298 §5）', () => {
    const steps = build('rto')

    it('ssthresh = 8 / 2 = 4、cwnd = 1 に下げ、スロースタートからやり直す', () => {
      expect(rounds(steps)).toEqual([
        ['1', '1', '8', 'slow start'],
        ['2', '2', '8', 'slow start'],
        ['3', '4', '8', 'slow start'],
        ['4', '8', '8', 'RTO'],
        ['5', '1', '4', 'slow start'],
        ['6', '2', '4', 'slow start'],
        ['7', '4', '4', 'congestion avoidance'],
      ])
      expect(windowHistory(steps).at(-1)).toEqual(['5', '4'])
    })

    it('ラウンド 4 のセグメントはすべて失われ、RTO の後に最初のセグメント（8）を再送する', () => {
      const lost = messages(steps).find((message) => message.id === 'data-4')
      expect(lost?.status).toBe('lost')
      const retransmission = messages(steps).find((message) => message.id === 'data-rtx')
      expect(retransmission).toMatchObject({ label: 'DATA #8', retransmitOf: 'data-4' })
      const derived = deriveState(tcpCongestionScenario.actors, steps, steps.length - 1)
      expect(derived.elapsedMs).toBe(1000)
    })
  })
})
