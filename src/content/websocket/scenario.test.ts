// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { maskPayload, utf8, type MaskingKey } from './frame'
import {
  ACCEPT_VALUE,
  FRAGMENTS,
  GUID,
  KEY,
  PHOTO_BYTES,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  webSocketScenario,
  WRONG_ACCEPT,
  type WebSocketOptions,
} from './scenario'

const handle = toScenarioHandle(webSocketScenario)
const defaults: WebSocketOptions = { problem: 'none', fragment: false }
const PROBLEMS = ['none', 'badAccept', 'noPong'] as const

function build(overrides: Partial<WebSocketOptions> = {}): readonly Step[] {
  return webSocketScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

const flow = (steps: readonly Step[]) =>
  messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function final(steps: readonly Step[]) {
  const state = deriveState(webSocketScenario.actors, steps, steps.length - 1)
  return {
    browser: state.actorStates.browser?.values,
    server: state.actorStates.server?.values,
    elapsedMs: state.elapsedMs,
  }
}

const bytes = (value: string | undefined) =>
  (value ?? '')
    .split(' ')
    .filter(Boolean)
    .map((b) => Number.parseInt(b, 16))

async function sha1Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

describe('webSocketScenario', () => {
  it('すべてのオプションの組み合わせ（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ problem: 'noPong', fragment: 'true' }).options).toEqual({
      problem: 'noPong',
      fragment: true,
    })
    expect(handle.resolve({ problem: 'timeout', fragment: '?' }).options).toEqual(defaults)
  })

  describe('開始のハンドシェイク（RFC 6455 §1.3、§4.1）', () => {
    it('Sec-WebSocket-Accept は base64(SHA-1(キー + GUID))。誤った値はキーだけのハッシュ', async () => {
      expect(await sha1Base64(KEY + GUID)).toBe(ACCEPT_VALUE)
      expect(await sha1Base64(KEY)).toBe(WRONG_ACCEPT)
      const response = messages(build()).find((m) => m.id === 'handshake-response')
      expect(field(response, 'Sec-WebSocket-Accept')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    })

    it('要求は GET で Upgrade: websocket、Connection: Upgrade、版 13、Origin', () => {
      const request = messages(build()).find((m) => m.id === 'handshake-request')
      expect(
        [
          'Request line',
          'Upgrade',
          'Connection',
          'Sec-WebSocket-Key',
          'Sec-WebSocket-Version',
          'Origin',
        ].map((name) => field(request, name)),
      ).toEqual([
        'GET /chat HTTP/1.1',
        'websocket',
        'Upgrade',
        KEY,
        '13',
        'https://www.example.com',
      ])
    })
  })

  describe('フレーム（RFC 6455 §5）', () => {
    it('正常なときの流れ', () => {
      expect(flow(build())).toEqual([
        'browser→server GET /chat (Upgrade: websocket) delivered',
        'server→browser 101 Switching Protocols delivered',
        'browser→server Text "Hello" (masked) delivered',
        'server→browser Text "Hi, Alice!" delivered',
        'server→browser Binary (100,000 bytes) delivered',
        'server→browser Ping "hb-1" delivered',
        'browser→server Pong "hb-1" (masked) delivered',
        'browser→server Close 1000 (masked) delivered',
        'server→browser Close 1000 delivered',
        'server→browser TCP FIN delivered',
        'browser→server TCP FIN delivered',
      ])
    })

    it('ブラウザーのフレームだけをマスクし、キーはフレームごとに違い、外すと元のペイロードに戻る', () => {
      const frames = messages(build()).filter((m) => field(m, 'MASK') !== undefined)
      const fromBrowser = frames.filter((m) => m.from === 'browser')
      expect(frames.filter((m) => m.from === 'server').map((m) => field(m, 'MASK'))).toEqual(
        Array(frames.length - fromBrowser.length).fill('0'),
      )
      expect(fromBrowser.map((m) => field(m, 'MASK'))).toEqual(['1', '1', '1'])
      const keys = fromBrowser.map((m) => field(m, 'Masking key'))
      expect(new Set(keys).size).toBe(keys.length)
      const text = fromBrowser[0]
      const key = bytes(field(text, 'Masking key'))
      const maskingKey: MaskingKey = [key[0] ?? 0, key[1] ?? 0, key[2] ?? 0, key[3] ?? 0]
      expect(maskPayload(bytes(field(text, 'Payload (on the wire)')), maskingKey)).toEqual(
        utf8('Hello'),
      )
      expect(field(text, 'Header bytes')).toBe('0x81 0x85 0x37 0xfa 0x21 0x3d')
      expect(field(text, 'Payload (on the wire)')).toBe('0x7f 0x9f 0x4d 0x51 0x58')
    })

    it('長さの表現: 7 ビット、64 ビット（100,000）、フラグメントでは 16 ビット', () => {
      const all = messages(build())
      expect(
        field(
          all.find((m) => m.id === 'server-push'),
          'Header bytes',
        ),
      ).toBe('0x81 0x0a')
      expect(
        field(
          all.find((m) => m.id === 'binary'),
          'Header bytes',
        ),
      ).toBe('0x82 0x7f 0x00 0x00 0x00 0x00 0x00 0x01 0x86 0xa0')
      const fragments = messages(build({ fragment: true })).filter((m) =>
        m.id.startsWith('binary-'),
      )
      expect(fragments.map((m) => field(m, 'Header bytes'))).toEqual([
        '0x02 0x7e 0x9c 0x40',
        '0x00 0x7e 0x9c 0x40',
        '0x80 0x7e 0x4e 0x20',
      ])
    })

    it('フラグメント: opcode は 0x2・0x0・0x0、FIN は 0・0・1、合計 100,000 バイトで、message のイベントは最後に 1 回', () => {
      const steps = build({ fragment: true })
      const fragments = messages(steps).filter((m) => m.id.startsWith('binary-'))
      expect(fragments.map((m) => [field(m, 'Opcode'), field(m, 'FIN')])).toEqual([
        ['0x2 (binary)', '0'],
        ['0x0 (continuation)', '0'],
        ['0x0 (continuation)', '1'],
      ])
      expect(FRAGMENTS.reduce((sum, size) => sum + size, 0)).toBe(PHOTO_BYTES)
      const events = steps
        .filter((step) => step.id.startsWith('binary-'))
        .map((step) =>
          step.events.some((event) => event.kind === 'stateChange' && event.key === 'event'),
        )
      expect(events).toEqual([false, false, true])
    })

    it('制御フレームは FIN = 1 で 125 バイト以下。Pong は Ping と同じペイロード。Close は 1000 を返す', () => {
      const all = messages(build())
      const controls = all.filter((m) => /^0x[89A]/.test(field(m, 'Opcode') ?? ''))
      for (const m of controls) {
        expect(field(m, 'FIN')).toBe('1')
        expect(Number.parseInt(field(m, 'Payload length') ?? '', 10)).toBeLessThanOrEqual(125)
      }
      const ping = all.find((m) => m.id === 'ping')
      const pong = all.find((m) => m.id === 'pong')
      expect(field(ping, 'Payload length')).toBe(field(pong, 'Payload length'))
      expect(
        field(
          all.find((m) => m.id === 'close-server'),
          'Payload',
        ),
      ).toBe('1000 (normal closure)')
      // 1005・1006・1015 は Close フレームで送らない
      expect(controls.some((m) => /100[56]|1015/.test(field(m, 'Payload') ?? ''))).toBe(false)
    })

    it('サーバーが先に TCP を閉じ、TIME-WAIT を持つ', () => {
      expect(final(build())).toMatchObject({
        browser: { readyState: 'CLOSED', tcp: 'CLOSED', event: 'close: 1000, wasClean true' },
        server: { connection: 'CLOSED (1000)', tcp: 'TIME-WAIT' },
      })
    })
  })

  describe('もしも', () => {
    it('誤った Accept: 101 は受け入れず、Close なしで TCP を閉じ、1006', () => {
      const steps = build({ problem: 'badAccept' })
      expect(flow(steps)).toEqual([
        'browser→server GET /chat (Upgrade: websocket) delivered',
        'server→browser 101 Switching Protocols rejected',
        'browser→server TCP FIN delivered',
        'server→browser TCP FIN delivered',
      ])
      const states = steps.map(
        (_, i) =>
          deriveState(webSocketScenario.actors, steps, i).actorStates.browser?.values.readyState,
      )
      expect(states).not.toContain('OPEN')
      expect(final(steps).browser).toMatchObject({
        readyState: 'CLOSED',
        event: 'error, close: 1006',
      })
      expect(build({ problem: 'badAccept', fragment: true })).toEqual(steps)
    })

    it('Pong が来ない: Ping は失われ、30 秒と 10 秒のタイマー、Close なしで閉じる。ブラウザーは OPEN のまま', () => {
      const steps = build({ problem: 'noPong' })
      expect(messages(steps).find((m) => m.id === 'ping')?.status).toBe('lost')
      expect(messages(steps).some((m) => m.label.startsWith('Close'))).toBe(false)
      const timers = steps.flatMap((step) =>
        step.events.flatMap((event) => (event.kind === 'timer' ? [event.durationMs] : [])),
      )
      expect(timers).toEqual([PING_INTERVAL_MS, PONG_TIMEOUT_MS])
      expect(final(steps)).toMatchObject({
        browser: { readyState: 'OPEN' },
        server: { connection: 'CLOSED (1006)', heartbeat: 'Pong timeout' },
        elapsedMs: 40_000,
      })
    })
  })

  it('ラベルは短い', () => {
    for (const problem of PROBLEMS) {
      for (const fragment of [false, true]) {
        expect(
          Math.max(...messages(build({ problem, fragment })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
