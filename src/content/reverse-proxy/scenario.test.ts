// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { clientIpFromXForwardedFor } from './headers'
import {
  ADDR,
  FORWARDED,
  PROXY_V1,
  reverseProxyScenario,
  VIA_INBOUND,
  VIA_OUTBOUND,
  X_FORWARDED_FOR,
  type ReverseProxyOptions,
} from './scenario'

const handle = toScenarioHandle(reverseProxyScenario)
const SITUATIONS = ['normal', 'backendDown', 'slowBackend', 'sticky', 'l4', 'sharedCache'] as const

const build = (situation: ReverseProxyOptions['situation'] = 'normal') =>
  reverseProxyScenario.buildSteps({ situation })

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

function stateAt(steps: readonly Step[], id: string) {
  const index = steps.findIndex((step) => step.id === id)
  return deriveState(reverseProxyScenario.actors, steps, index).actorStates
}
const final = (steps: readonly Step[]) =>
  deriveState(reverseProxyScenario.actors, steps, steps.length - 1).actorStates

const OPENING = [
  'proxy→backendA GET /healthz HTTP/1.1 delivered',
  'proxy→backendB GET /healthz HTTP/1.1 delivered',
  'backendA→proxy 200 OK delivered',
  'backendB→proxy 200 OK delivered',
  'browser→proxy ClientHello (SNI, ALPN h2) delivered',
  'proxy→browser ServerHello … Finished delivered',
  'browser→proxy Finished delivered',
  'browser→proxy GET /api/items [h2 stream 1] delivered',
  'proxy→backendA GET /api/items HTTP/1.1 delivered',
  'backendA→proxy 200 OK delivered',
  'proxy→browser 200 OK [h2 stream 1] delivered',
]
const POST_TO_B = [
  'browser→proxy POST /api/orders [h2 stream 3] delivered',
  'proxy→backendB POST /api/orders HTTP/1.1 delivered',
]

describe('reverseProxyScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'l4' }).options).toEqual({ situation: 'l4' })
    expect(handle.resolve({ situation: 'cdn' }).options).toEqual({ situation: 'normal' })
  })

  it('ラベルは 40 文字以内', () => {
    for (const situation of SITUATIONS) {
      expect(
        Math.max(...messages(build(situation)).map((m) => m.label.length)),
      ).toBeLessThanOrEqual(40)
    }
  })

  describe('流れ', () => {
    it('正常: ラウンドロビンで A、B、A。3 つ目は A への接続を使い回す', () => {
      const steps = build()
      expect(flow(steps)).toEqual([
        ...OPENING,
        ...POST_TO_B,
        'backendB→proxy 201 Created delivered',
        'proxy→browser 201 Created [h2 stream 3] delivered',
        'browser→proxy GET /api/items [h2 stream 5] delivered',
        'proxy→backendA GET /api/items HTTP/1.1 delivered',
        'backendA→proxy 200 OK delivered',
        'proxy→browser 200 OK [h2 stream 5] delivered',
      ])
      const { proxy, backendA, backendB } = final(steps)
      expect(proxy?.values.upstream).toEqual({
        columns: ['Conn', 'Backend', 'Requests', 'State'],
        rows: [
          ['#1', 'A', '2', 'idle'],
          ['#2', 'B', '1', 'idle'],
        ],
      })
      expect([backendA?.values.handled, backendB?.values.handled]).toEqual(['2', '1'])
    })

    it('バックエンドが落ちる: POST は再試行せず 502。ヘルスチェックで外し、B の番も A に送る', () => {
      const steps = build('backendDown')
      expect(flow(steps)).toEqual([
        ...OPENING,
        ...POST_TO_B,
        'backendB→proxy FIN (no response) delivered',
        'proxy→browser 502 Bad Gateway [h2 stream 3] delivered',
        'proxy→backendA GET /healthz HTTP/1.1 delivered',
        'proxy→backendB SYN delivered',
        'backendA→proxy 200 OK delivered',
        'backendB→proxy RST, ACK delivered',
        'browser→proxy GET /api/items [h2 stream 5] delivered',
        'proxy→backendA GET /api/items HTTP/1.1 delivered',
        'backendA→proxy 200 OK delivered',
        'proxy→browser 200 OK [h2 stream 5] delivered',
        'browser→proxy GET /api/items [h2 stream 7] delivered',
        'proxy→backendA GET /api/items HTTP/1.1 delivered',
        'backendA→proxy 200 OK delivered',
        'proxy→browser 200 OK [h2 stream 7] delivered',
      ])
      // POST は A に送り直さない
      expect(
        messages(steps).filter((m) => m.label.startsWith('POST') && m.to === 'backendA'),
      ).toEqual([])
      expect(field(byId(steps, 'bad-gateway'), 'proxy-status')).toBe(
        'proxy1; error=connection_terminated; next-hop="198.51.100.12:8080"',
      )
      expect(stateAt(steps, 'crash').proxy?.values.pool).toEqual({
        columns: ['Backend', 'Address', 'Health', 'Fails'],
        rows: [
          ['A', '198.51.100.11:8080', 'up', '0'],
          ['B', '198.51.100.12:8080', 'up', '1'],
        ],
      })
      expect(final(steps).proxy?.values.pool).toEqual({
        columns: ['Backend', 'Address', 'Health', 'Fails'],
        rows: [
          ['A', '198.51.100.11:8080', 'up', '0'],
          ['B', '198.51.100.12:8080', 'down', '2'],
        ],
      })
      expect(steps.flatMap((s) => s.events).filter((e) => e.kind === 'timer')).toEqual([
        { kind: 'timer', actorId: 'proxy', name: 'health check', durationMs: 5000 },
      ])
    })

    it('遅いバックエンド: 30 秒で 504。注文はあとでできている', () => {
      const steps = build('slowBackend')
      expect(flow(steps)).toEqual([
        ...OPENING,
        ...POST_TO_B,
        'proxy→backendB FIN (gave up waiting) delivered',
        'proxy→browser 504 Gateway Timeout [h2 stream 3] delivered',
        'backendB→proxy 201 Created (too late) rejected',
        'proxy→backendB RST delivered',
      ])
      expect(field(byId(steps, 'gateway-timeout'), 'proxy-status')).toBe(
        'proxy1; error=http_response_timeout',
      )
      const timers = steps.flatMap((s) => s.events).filter((e) => e.kind === 'timer')
      expect(timers.map((t) => t.durationMs)).toEqual([30_000, 15_000])
      const { backendB, browser } = final(steps)
      expect(backendB?.values.process).toBe('order 1001 created')
      expect(browser?.values.response).toBe('504 Gateway Timeout')
    })

    it('スティッキーセッション: Cookie で A に固定し、Cookie は転送しない', () => {
      const steps = build('sticky')
      expect(flow(steps)).toEqual([
        ...OPENING,
        'browser→proxy POST /api/orders [h2 stream 3] delivered',
        'proxy→backendA POST /api/orders HTTP/1.1 delivered',
        'backendA→proxy 201 Created delivered',
        'proxy→browser 201 Created [h2 stream 3] delivered',
      ])
      expect(field(byId(steps, 'relay-1'), 'set-cookie')).toBe(
        'SERVERID=a; Path=/; Secure; HttpOnly',
      )
      expect(field(byId(steps, 'request-2'), 'cookie')).toBe('SERVERID=a')
      expect(field(byId(steps, 'forward-2'), 'Cookie')).toBeUndefined()
      const { backendA, backendB } = final(steps)
      expect([backendA?.values.handled, backendB?.values.handled]).toEqual(['2', '0'])
    })

    it('L4: 接続ごとに 1 回選び、TLS はそのまま通し、PROXY protocol で元のアドレスを伝える', () => {
      const steps = build('l4')
      const all = messages(steps)
      expect(all.some((m) => m.to === 'backendB' || m.from === 'backendB')).toBe(false)
      expect(all.filter((m) => m.label === 'TLS application data')).toHaveLength(8)
      expect(all.filter((m) => m.label === 'TLS application data').every((m) => m.encrypted)).toBe(
        true,
      )
      expect(field(byId(steps, 'proxy-header'), 'Line')).toBe(
        'PROXY TCP4 203.0.113.50 192.0.2.10 51514 443\\r\\n',
      )
      expect(PROXY_V1).toBe('PROXY TCP4 203.0.113.50 192.0.2.10 51514 443\r\n')
      // L4 では Forwarded も Via も付けられない
      expect(
        all.some((m) => m.fields.some((f) => f.name === 'Forwarded' || f.name === 'Via')),
      ).toBe(false)
      const { proxy } = final(steps)
      expect(proxy?.values.tls).toBe('passthrough (ciphertext only)')
      expect(proxy?.values.pool).toEqual({
        columns: ['Backend', 'Address', 'Health', 'Fails'],
        rows: [
          ['A', '198.51.100.11:443', 'up', '0'],
          ['B', '198.51.100.12:443', 'up', '0'],
        ],
      })
      expect(field(byId(steps, 'back-syn'), 'Dst')).toBe('198.51.100.11:443')
      expect(stateAt(steps, 'tcp-front').proxy?.values.pool).toEqual(proxy?.values.pool)
    })

    it('共有キャッシュ: s-maxage で保存し、20 秒後はバックエンドに聞かずに返す。private は保存しない', () => {
      const steps = build('sharedCache')
      expect(flow(steps)).toEqual([
        ...OPENING,
        'browser→proxy GET /api/items [h2 stream 3] delivered',
        'proxy→browser 200 OK [h2 stream 3] delivered',
        'browser→proxy GET /api/me [h2 stream 5] delivered',
        'proxy→backendB GET /api/me HTTP/1.1 delivered',
        'backendB→proxy 200 OK delivered',
        'proxy→browser 200 OK [h2 stream 5] delivered',
      ])
      expect(field(byId(steps, 'response-1'), 'Cache-Control')).toBe('max-age=0, s-maxage=60')
      expect(field(byId(steps, 'relay-1'), 'cache-status')).toBe('proxy1; fwd=uri-miss; stored')
      const hit = byId(steps, 'hit')
      expect([field(hit, 'age'), field(hit, 'cache-status')]).toEqual(['20', 'proxy1; hit; ttl=40'])
      expect(field(byId(steps, 'relay-3'), 'cache-status')).toBe('proxy1; fwd=uri-miss')
      expect(final(steps).proxy?.values.cache).toEqual({
        columns: ['URL', 'Cache-Control', 'Age', 'Status'],
        rows: [['/api/items', 'max-age=0, s-maxage=60', '20', 'fresh']],
      })
      expect(final(steps).backendA?.values.handled).toBe('1')
    })

    it('Cache-Control の説明は応答ごと。キャッシュから返すときは Removed を付けない', () => {
      const steps = build('sharedCache')
      const description = (id: string) =>
        byId(steps, id)?.fields.find((f) => f.name === 'Cache-Control')?.description?.en
      expect(description('response-1')).toContain('s-maxage')
      expect(description('response-3')).toContain('private')
      expect(description('response-3')).not.toContain('s-maxage')
      expect(field(byId(steps, 'hit'), 'Removed')).toBeUndefined()
      expect(field(byId(steps, 'relay-1'), 'Removed')).toBe('Connection, Keep-Alive')
    })
  })

  describe('転送のヘッダー', () => {
    it('Host は :authority から。Forwarded・X-Forwarded-*・Via でクライアントと経路を伝える', () => {
      const steps = build()
      const forward = byId(steps, 'forward-1')
      expect(field(byId(steps, 'request-1'), ':authority')).toBe(ADDR.site)
      expect(field(forward, 'Host')).toBe(ADDR.site)
      expect(FORWARDED).toBe('for=203.0.113.50;proto=https;host=www.example.com')
      expect(field(forward, 'Forwarded')).toBe(FORWARDED)
      expect(field(forward, 'X-Forwarded-For')).toBe('203.0.113.50')
      expect(field(forward, 'X-Forwarded-Proto')).toBe('https')
      expect([VIA_INBOUND, VIA_OUTBOUND]).toEqual(['2.0 proxy1', '1.1 proxy1'])
      expect(field(forward, 'Via')).toBe('2.0 proxy1')
      expect(field(byId(steps, 'relay-1'), 'via')).toBe('1.1 proxy1')
      expect(clientIpFromXForwardedFor(X_FORWARDED_FOR, 1)).toBe(ADDR.browser)
    })

    it('バックエンドから見えるのはプロキシのアドレスと http', () => {
      const { backendA } = stateAt(build(), 'forward-1')
      expect(backendA?.values.seen).toEqual({
        columns: ['Field', 'Value'],
        rows: [
          ['TCP peer', '198.51.100.1:40001'],
          ['Scheme', 'http'],
          ['Host', 'www.example.com'],
          ['Forwarded for', '203.0.113.50'],
          ['Forwarded proto', 'https'],
        ],
      })
    })

    it('区間ごとの Connection と Keep-Alive を外し、HTTP/2 のフィールド名は小文字', () => {
      const steps = build()
      expect(field(byId(steps, 'response-1'), 'Connection')).toBe('keep-alive')
      const relay = byId(steps, 'relay-1')
      expect(field(relay, 'Removed')).toBe('Connection, Keep-Alive')
      expect(relay?.fields.some((f) => f.name.toLowerCase() === 'connection')).toBe(false)
      expect(field(relay, 'content-type')).toBe('application/json')
    })

    it('HTTP/1.1 の本文には Content-Length を付ける（バイト数）', () => {
      const steps = build()
      expect(field(byId(steps, 'forward-2'), 'Content-Length')).toBe('11')
      expect(field(byId(steps, 'response-1'), 'Content-Length')).toBe(
        String(new TextEncoder().encode('{"items":[…],"served_by":"A"}').length),
      )
    })

    it('ブラウザーとプロキシの間は暗号化され、プロキシとバックエンドの間は平文', () => {
      const steps = build()
      expect(byId(steps, 'request-1')?.encrypted).toBe(true)
      expect(byId(steps, 'relay-1')?.encrypted).toBe(true)
      expect(byId(steps, 'forward-1')?.encrypted).toBeUndefined()
      expect(final(steps).proxy?.values.tls).toBe('terminated (cert www.example.com)')
    })
  })
})
