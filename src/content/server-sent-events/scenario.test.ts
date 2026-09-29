// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { parseEventStream } from './eventStream'
import { EVENT_LOG, eventsAfter, RETRY_MS, sseScenario, type SseOptions } from './scenario'

const handle = toScenarioHandle(sseScenario)
const SITUATIONS = ['normal', 'reconnect', 'stop204', 'wrongType', 'http1Limit', 'http2'] as const
const build = (situation: SseOptions['situation'] = 'normal') =>
  sseScenario.buildSteps({ situation })

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}
const flow = (steps: readonly Step[]) =>
  messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)
const field = (message: Message | undefined, name: string) =>
  message?.fields.find((f) => f.name === name)?.value
const final = (steps: readonly Step[]) => deriveState(sseScenario.actors, steps, steps.length - 1)
const unescape = (text: string) => text.replace(/\\n/g, '\n')

const OPENING = [
  'browser→server GET /events delivered',
  'server→browser 200 OK (text/event-stream) delivered',
  'server→browser id: 1 (event: price) delivered',
  'server→browser id: 2 (two data lines) delivered',
]

describe('sseScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'http2' }).options).toEqual({ situation: 'http2' })
    expect(handle.resolve({ situation: 'websocket' }).options).toEqual({ situation: 'normal' })
  })

  it('ラベルは 40 文字以内', () => {
    for (const situation of SITUATIONS) {
      expect(
        Math.max(...messages(build(situation)).map((m) => m.label.length)),
      ).toBeLessThanOrEqual(40)
    }
  })

  describe('流れと readyState', () => {
    it('正常: イベントが届き、コメントは何も発火せず、close() で閉じる', () => {
      const steps = build()
      expect(flow(steps)).toEqual([
        ...OPENING,
        'server→browser : keep-alive (comment) delivered',
        'server→browser id: 3 (message) delivered',
        'browser→server FIN (TCP) delivered',
      ])
      expect(final(steps).actorStates.browser?.values.readyState).toBe('CLOSED')
    })

    it('接続が切れる: retry の待ち時間のあと Last-Event-ID: 2 で接続し直し、3 と 4 を受け取る', () => {
      const steps = build('reconnect')
      expect(flow(steps)).toEqual([
        ...OPENING,
        'server→browser FIN (TCP), no last chunk delivered',
        'browser→server GET /events (Last-Event-ID: 2) delivered',
        'server→browser 200 OK (text/event-stream) delivered',
        'server→browser id: 3, id: 4 (replay) delivered',
      ])
      expect(field(byId(steps, 'reconnect'), 'Last-Event-ID')).toBe('2')
      expect(field(byId(steps, 'request'), 'Last-Event-ID')).toBeUndefined()
      const timers = steps.flatMap((s) => s.events).filter((e) => e.kind === 'timer')
      expect(timers).toEqual([
        { kind: 'timer', actorId: 'browser', name: 'retry', durationMs: RETRY_MS },
      ])
      const replayed = parseEventStream(
        unescape(field(byId(steps, 'replay'), 'Lines') ?? ''),
      ).events
      expect(replayed.map((e) => e.lastEventId)).toEqual(
        eventsAfter(EVENT_LOG, '2').map((e) => e.id),
      )
      const state = final(steps).actorStates.browser?.values
      expect([state?.readyState, state?.lastEventId]).toEqual(['OPEN', '4'])
    })

    it('204 で止まる: 最後のチャンクで終えても再接続し、204 で CLOSED', () => {
      const steps = build('stop204')
      expect(flow(steps).slice(-3)).toEqual([
        'server→browser 0 (last chunk) delivered',
        'browser→server GET /events (Last-Event-ID: 2) delivered',
        'server→browser 204 No Content rejected',
      ])
      expect(final(steps).actorStates.browser?.values.readyState).toBe('CLOSED')
      // 最後のチャンクのあとも、ブラウザーは CONNECTING になって error を発火し、同じ接続 #1 を使い回す
      const end = steps.findIndex((s) => s.id === 'end')
      const atEnd = deriveState(sseScenario.actors, steps, end).actorStates.browser?.values
      expect(atEnd?.readyState).toBe('CONNECTING')
      const events = atEnd?.events
      expect(typeof events === 'object' ? events.rows.at(-1) : undefined).toEqual([
        'error',
        '-',
        '-',
      ])
      expect(field(byId(steps, 'reconnect'), 'On connection')).toBe('#1')
    })

    it('Content-Type の誤り: 200 でも失敗にして、試し直さない', () => {
      const steps = build('wrongType')
      expect(flow(steps)).toEqual([
        'browser→server GET /events delivered',
        'server→browser 200 OK (text/html) rejected',
      ])
      expect(final(steps).actorStates.browser?.values.readyState).toBe('CLOSED')
    })
  })

  describe('ページに届いたイベント', () => {
    it('イベントの表は、届いた文字列を解析した結果と同じ', () => {
      const steps = build()
      const lines = messages(steps)
        .map((m) => field(m, 'Lines'))
        .filter((value): value is string => value !== undefined)
        .map(unescape)
        .join('')
      const parsed = parseEventStream(lines).events.map((e) => [
        e.type,
        e.data.replace(/\n/g, '\\n'),
        e.lastEventId,
      ])
      const table = final(steps).actorStates.browser?.values.events
      const rows =
        typeof table === 'object'
          ? table.rows.filter((row) => row[0] !== 'open' && row[0] !== 'error')
          : []
      expect(rows).toEqual(parsed)
      expect(rows).toEqual([
        ['price', 'EXMPL 101.5', '1'],
        ['news', 'Q3 results\\nat 15:00', '2'],
        ['message', 'Market closes in 10 min', '3'],
      ])
    })

    it('retry で再接続の待ち時間が 5000 ms になる', () => {
      expect(final(build()).actorStates.browser?.values.reconnectionTime).toBe('5000 ms')
    })

    it('chunk のサイズはバイト数の 16 進', () => {
      const steps = build()
      expect(field(byId(steps, 'event-1'), 'Chunk size')).toBe('32 (50 bytes)')
      expect(field(byId(steps, 'heartbeat'), 'Chunk size')).toBe('e (14 bytes)')
    })
  })

  describe('接続の数', () => {
    it('HTTP/1.1: 6 本がふさがると次の要求は待たされ、1 本空くと出ていく', () => {
      const steps = build('http1Limit')
      const queued = steps.findIndex((s) => s.id === 'queued')
      const table = deriveState(sseScenario.actors, steps, queued).actorStates.browser?.values
        .connections
      const rows = typeof table === 'object' ? table.rows : []
      expect(rows.filter((row) => row[2] === 'streaming')).toHaveLength(6)
      expect(rows).toContainEqual(['-', 'GET /api/cart (tab 1)', 'queued'])
      const last = final(steps).actorStates.browser?.values.connections
      expect(typeof last === 'object' ? last.rows : []).toContainEqual([
        '#7',
        'GET /api/cart (tab 1)',
        'idle',
      ])
    })

    it('HTTP/2: 1 本の接続の奇数のストリーム 1〜13 で、Transfer-Encoding はない', () => {
      const steps = build('http2')
      const ids = messages(steps)
        .filter((m) => m.from === 'browser')
        .map((m) => field(m, 'Stream ID'))
      expect(ids).toEqual(['1', '3', '5', '7', '9', '11', '13'])
      expect(
        messages(steps).some((m) =>
          m.fields.some((f) => f.name.toLowerCase() === 'transfer-encoding'),
        ),
      ).toBe(false)
    })
  })
})
