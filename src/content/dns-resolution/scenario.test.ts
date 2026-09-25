// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { dnsResolutionScenario, type DnsOptions } from './scenario'

const handle = toScenarioHandle(dnsResolutionScenario)
const defaults: DnsOptions = { cache: 'empty', name: 'www', serverDown: false }

function build(overrides: Partial<DnsOptions> = {}): readonly Step[] {
  return dnsResolutionScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function route(steps: readonly Step[]): string[] {
  return messages(steps).map((m) => `${m.from}→${m.to}${m.status === 'lost' ? ' (lost)' : ''}`)
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function final(steps: readonly Step[]) {
  const derived = deriveState(dnsResolutionScenario.actors, steps, steps.length - 1)
  const cache = derived.actorStates.resolver?.values.cache
  return {
    result: derived.actorStates.stub?.values.result,
    cache:
      typeof cache === 'object' ? cache.rows.map((row) => `${row[0] ?? ''} ${row[1] ?? ''}`) : [],
    elapsedMs: derived.elapsedMs,
  }
}

describe('dnsResolutionScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ cache: 'answer', name: 'alias', serverDown: '1' }).options).toEqual({
      cache: 'answer',
      name: 'alias',
      serverDown: true,
    })
    expect(handle.resolve({ cache: 'full', name: 'x' }).options).toEqual(defaults)
  })

  describe('正常系（RFC 1034 §4.3.1, §5.3.3）', () => {
    const steps = build()

    it('スタブ → リゾルバ → ルート → .com → 権威 → リゾルバ → スタブの順にたどる', () => {
      expect(route(steps)).toEqual([
        'stub→resolver',
        'resolver→root',
        'root→resolver',
        'resolver→tld',
        'tld→resolver',
        'resolver→auth',
        'auth→resolver',
        'resolver→stub',
      ])
    })

    it('スタブは再帰問い合わせ（RD）、リゾルバは反復問い合わせ（RD なし）', () => {
      const [stubQuery, rootQuery] = messages(steps)
      expect(field(stubQuery, 'Flags')).toBe('RD')
      expect(field(rootQuery, 'Flags')).toBe('(none)')
    })

    it('ルートと .com は委任（Authority に NS、Additional に glue、AA なし）、権威サーバーは AA 付きで答える', () => {
      const all = messages(steps)
      const rootReferral = all.find((m) => m.id === 'root-referral')
      const tldReferral = all.find((m) => m.id === 'tld-referral')
      const authAnswer = all.find((m) => m.id === 'auth-answer')
      expect(field(rootReferral, 'Flags')).toBe('QR')
      expect(field(rootReferral, 'Authority')).toBe('com. NS a.gtld-servers.net. 172800')
      expect(field(rootReferral, 'Additional')).toBe('a.gtld-servers.net. A 192.5.6.30 172800')
      expect(field(tldReferral, 'Authority')).toContain('example.com. NS ns1.example.com.')
      expect(field(tldReferral, 'Additional')).toContain('ns1.example.com. A 192.0.2.53')
      expect(field(authAnswer, 'Flags')).toBe('QR AA')
      expect(field(authAnswer, 'Answer')).toBe('www.example.com. A 192.0.2.10 300')
    })

    it('応答は問い合わせと同じ ID。スタブへの応答は RA 付き・AA なし', () => {
      const all = messages(steps)
      expect(field(all[0], 'ID')).toBe(field(all.at(-1), 'ID'))
      for (const [queryId, responseId] of [
        ['root-query', 'root-referral'],
        ['tld-query', 'tld-referral'],
        ['auth-query', 'auth-answer'],
      ]) {
        expect(
          field(
            all.find((m) => m.id === queryId),
            'ID',
          ),
        ).toBe(
          field(
            all.find((m) => m.id === responseId),
            'ID',
          ),
        )
      }
      expect(field(all[0], 'Transport')).toBe('UDP → 198.51.100.53:53')
      expect(field(all.at(-1), 'Flags')).toBe('QR RD RA')
    })

    it('リゾルバは委任と答えをキャッシュし、スタブは答えを得る', () => {
      expect(final(steps)).toEqual({
        result: '192.0.2.10',
        cache: [
          'com. NS',
          'a.gtld-servers.net. A',
          'example.com. NS',
          'example.com. NS',
          'ns1.example.com. A',
          'ns2.example.com. A',
          'www.example.com. A',
        ],
        elapsedMs: 0,
      })
    })
  })

  describe('キャッシュ', () => {
    it('委任を知っていれば、ルートと .com を飛ばして権威サーバーに聞く', () => {
      expect(route(build({ cache: 'delegation' }))).toEqual([
        'stub→resolver',
        'resolver→auth',
        'auth→resolver',
        'resolver→stub',
      ])
    })

    it('答えを知っていれば、どこにも聞かずに残りの TTL で答える（AA なし）。キャッシュの TTL も同じ', () => {
      const steps = build({ cache: 'answer' })
      const derived = deriveState(dnsResolutionScenario.actors, steps, 0)
      const cache = derived.actorStates.resolver?.values.cache
      expect(typeof cache === 'object' ? cache.rows.at(-1) : undefined).toEqual([
        'www.example.com.',
        'A',
        '192.0.2.10',
        '245',
      ])
      expect(route(steps)).toEqual(['stub→resolver', 'resolver→stub'])
      expect(field(messages(steps).at(-1), 'Answer')).toBe('www.example.com. A 192.0.2.10 245')
      expect(field(messages(steps).at(-1), 'Flags')).not.toContain('AA')
    })

    it('答えがキャッシュにあれば、サーバーが応答しない設定は影響しない', () => {
      expect(build({ cache: 'answer', serverDown: true })).toEqual(build({ cache: 'answer' }))
    })
  })

  describe('NXDOMAIN（RFC 2308）', () => {
    const steps = build({ name: 'missing' })

    it('権威サーバーは NXDOMAIN と SOA を返し、リゾルバは否定応答をキャッシュする', () => {
      const authAnswer = messages(steps).find((m) => m.id === 'auth-answer')
      expect(field(authAnswer, 'RCODE')).toBe('NXDOMAIN')
      expect(field(authAnswer, 'Answer')).toBe('(empty)')
      expect(field(authAnswer, 'Authority')).toContain('example.com. SOA')
      expect(final(steps).cache.at(-1)).toBe('no-such-host.example.com. (negative)')
      expect(final(steps).result).toBe('NXDOMAIN')
    })

    it('スタブへも NXDOMAIN と SOA を伝える（Answer は空）', () => {
      const stubAnswer = messages(steps).at(-1)
      expect(field(stubAnswer, 'RCODE')).toBe('NXDOMAIN')
      expect(field(stubAnswer, 'Answer')).toBe('(empty)')
      expect(field(stubAnswer, 'Authority')).toContain('example.com. SOA')
    })

    it('キャッシュに www の答えがあっても、別の名前は権威サーバーに聞く', () => {
      expect(route(build({ name: 'missing', cache: 'answer' }))).toEqual([
        'stub→resolver',
        'resolver→auth',
        'auth→resolver',
        'resolver→stub',
      ])
    })
  })

  describe('CNAME（RFC 1034 §4.3.2）', () => {
    it('別名の CNAME と、同じゾーンの行き先の A をまとめて返す', () => {
      const steps = build({ name: 'alias' })
      const authAnswer = messages(steps).find((m) => m.id === 'auth-answer')
      expect(field(authAnswer, 'Answer')).toBe(
        'shop.example.com. CNAME www.example.com. 300\nwww.example.com. A 192.0.2.10 300',
      )
      expect(final(steps).result).toBe('192.0.2.10')
      expect(final(steps).cache.slice(-2)).toEqual([
        'shop.example.com. CNAME',
        'www.example.com. A',
      ])
    })

    it('行き先の A がすでにキャッシュにあれば、権威の答えで置き換えて TTL を更新する', () => {
      const steps = build({ name: 'alias', cache: 'answer' })
      const derived = deriveState(dnsResolutionScenario.actors, steps, steps.length - 1)
      const cache = derived.actorStates.resolver?.values.cache
      const rows = typeof cache === 'object' ? cache.rows : []
      expect(rows.filter((row) => row[0] === 'www.example.com.')).toEqual([
        ['www.example.com.', 'A', '192.0.2.10', '300'],
      ])
      expect(rows.at(-2)?.[1]).toBe('CNAME')
    })

    it('反復問い合わせでも、質問する名前は別名のまま', () => {
      const steps = build({ name: 'alias' })
      expect(
        field(
          messages(steps).find((m) => m.id === 'root-query'),
          'Question',
        ),
      ).toBe('shop.example.com. IN A')
      expect(messages(steps).at(-1)?.label).toBe('Answer: CNAME www.example.com.')
    })
  })

  describe('1 台目の権威サーバーが応答しない', () => {
    it('タイムアウトの後、2 台目のサーバーに問い合わせる', () => {
      const steps = build({ serverDown: true })
      const auth = messages(steps).filter((m) => m.to === 'auth')
      expect(auth.map((m) => [m.status, field(m, 'Transport')])).toEqual([
        ['lost', 'UDP → 192.0.2.53:53'],
        ['delivered', 'UDP → 192.0.2.54:53'],
      ])
      expect(final(steps).elapsedMs).toBe(1500)
      expect(final(steps).result).toBe('192.0.2.10')
      expect(
        field(
          messages(steps).find((m) => m.id === 'auth-answer'),
          'ID',
        ),
      ).toBe('0x7e04')
    })
  })
})
