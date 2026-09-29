// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { hstsScenario, PASSWORD_BODY, STS_VALUE, type HstsOptions } from './scenario'

const handle = toScenarioHandle(hstsScenario)
const SITUATIONS = ['noHsts', 'known', 'expired', 'badCert', 'subdomain', 'preload'] as const
const PROTECTED = ['known', 'subdomain', 'preload'] as const

const build = (situation: HstsOptions['situation'] = 'noHsts') =>
  hstsScenario.buildSteps({ situation })

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}
const flow = (steps: readonly Step[]) =>
  messages(steps).map(
    (m) => `${m.from}→${m.to} ${m.label} ${m.status}${m.encrypted === true ? ' 🔒' : ''}`,
  )
const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)
const field = (message: Message | undefined, name: string) =>
  message?.fields.find((f) => f.name === name)?.value
const final = (steps: readonly Step[]) =>
  deriveState(hstsScenario.actors, steps, steps.length - 1).actorStates

const STRIPPED = (page: string) => [
  'browser→attacker GET / HTTP/1.1 (port 80) delivered',
  'attacker→site GET / HTTP/1.1 delivered',
  'site→attacker 301 Moved Permanently delivered',
  'attacker→site ClientHello (SNI example.com) delivered',
  'site→attacker ServerHello … Finished delivered',
  'attacker→site Finished delivered 🔒',
  'attacker→site GET / (inside TLS) delivered 🔒',
  `site→attacker ${page} delivered 🔒`,
  'attacker→browser 200 OK (https links → http) delivered',
  'browser→attacker POST /login (http) delivered',
  'attacker→site POST /login (inside TLS) delivered 🔒',
  'site→attacker 303 See Other delivered 🔒',
  'attacker→browser 303 See Other (Secure removed) delivered',
]
const RELAYED = (sni: string) => [
  `browser→attacker ClientHello (SNI ${sni}) delivered`,
  `attacker→site ClientHello (SNI ${sni}) delivered`,
  'site→attacker ServerHello … Finished delivered',
  'attacker→browser ServerHello … Finished delivered',
  'browser→attacker Finished delivered 🔒',
  'attacker→site Finished delivered 🔒',
  'browser→attacker GET / (inside TLS) delivered 🔒',
  'attacker→site GET / (inside TLS) delivered 🔒',
  'site→attacker 200 OK (HSTS header) delivered 🔒',
  'attacker→browser 200 OK (HSTS header) delivered 🔒',
]

describe('hstsScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'preload' }).options).toEqual({ situation: 'preload' })
    expect(handle.resolve({ situation: 'https-first' }).options).toEqual({ situation: 'noHsts' })
  })

  it('ラベルは 40 文字以内で、タイマーは使わない', () => {
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      expect(Math.max(...messages(steps).map((m) => m.label.length))).toBeLessThanOrEqual(40)
      expect(steps.flatMap((s) => s.events).some((e) => e.kind === 'timer')).toBe(false)
    }
  })

  describe('流れ', () => {
    it('HSTS なし: 最初の http を乗っ取られ、パスワードとセッションが漏れる', () => {
      expect(flow(build())).toEqual(STRIPPED('200 OK'))
    })

    it('期限切れ: 初めての訪問と同じく乗っ取られる。サイトのヘッダーは攻撃者にしか届かない', () => {
      const steps = build('expired')
      expect(flow(steps)).toEqual(STRIPPED('200 OK (HSTS header)'))
      expect(field(byId(steps, 'page'), 'Strict-Transport-Security')).toBe(STS_VALUE)
      expect(field(byId(steps, 'rewritten'), 'Strict-Transport-Security')).toBe('(removed)')
    })

    it('既知の HSTS ホスト、includeSubDomains、プリロード: 最初から https で、攻撃者は中継するだけ', () => {
      expect(flow(build('known'))).toEqual(RELAYED('example.com'))
      expect(flow(build('subdomain'))).toEqual(RELAYED('www.example.com'))
      expect(flow(build('preload'))).toEqual(RELAYED('example.com'))
    })

    it('攻撃者の証明書: 拒んで打ち切り、サイトには何も届かない', () => {
      const steps = build('badCert')
      expect(flow(steps)).toEqual([
        'browser→attacker ClientHello (SNI example.com) delivered',
        'attacker→browser ServerHello … Finished (fake cert) rejected',
        'browser→attacker Alert: unknown_ca delivered 🔒',
      ])
      expect(messages(steps).some((m) => m.to === 'site' || m.from === 'site')).toBe(false)
      expect(final(steps).browser?.values.url).toBe('error page (no proceed)')
    })
  })

  describe('HSTS の働き', () => {
    it('HSTS が効くときは、ポート 80 に何も送らず、http の要求がない', () => {
      for (const situation of [...PROTECTED, 'badCert'] as const) {
        const all = messages(build(situation))
        expect(all.some((m) => m.label.includes('port 80') || m.label.includes('(http)'))).toBe(
          false,
        )
      }
    })

    it('平文の区間は暗号化しない。Strict-Transport-Security はサイトが TLS の中で送るだけ', () => {
      for (const situation of SITUATIONS) {
        for (const message of messages(build(situation))) {
          const sts = field(message, 'Strict-Transport-Security')
          if (sts !== undefined && sts !== '(removed)') {
            expect(message.encrypted).toBe(true)
          }
          if (message.label.includes('(http)') || message.label.includes('port 80')) {
            expect(message.encrypted).toBeUndefined()
          }
        }
      }
    })

    it('照合の結果と、書き換え後の URL', () => {
      const check = (situation: HstsOptions['situation']) => {
        const steps = build(situation)
        return deriveState(hstsScenario.actors, steps, 0).actorStates.browser?.values.check
      }
      expect(SITUATIONS.map(check)).toEqual([
        'no match',
        'congruent: example.com',
        'expired (evicted)',
        'congruent: example.com',
        'superdomain: example.com (includeSubDomains)',
        'congruent: example.com (preload list)',
      ])
      const upgrade = build('known').findIndex((s) => s.id === 'upgrade')
      expect(
        deriveState(hstsScenario.actors, build('known'), upgrade).actorStates.browser?.values.url,
      ).toBe('https://example.com/ (HSTS upgrade)')
    })

    it('記録の更新: 既知なら期限が 1 年後に延び、サブドメインは自分の行を足し、上位の行は変えない', () => {
      expect(final(build('known')).browser?.values.hsts).toEqual({
        columns: ['Host', 'Subdomains', 'Expires', 'Source'],
        rows: [['example.com', 'yes', '2027-10-01T09:00:00Z', 'header']],
      })
      expect(final(build('subdomain')).browser?.values.hsts).toEqual({
        columns: ['Host', 'Subdomains', 'Expires', 'Source'],
        rows: [
          ['example.com', 'yes', '2027-06-01T09:00:00Z', 'header'],
          ['www.example.com', 'no', '2027-10-01T09:00:00Z', 'header'],
        ],
      })
      expect(final(build('preload')).browser?.values.hsts).toEqual({
        columns: ['Host', 'Subdomains', 'Expires', 'Source'],
        rows: [
          ['example.com', 'yes', '(built in)', 'preload list'],
          ['example.com', 'yes', '2027-10-01T09:00:00Z', 'header'],
        ],
      })
    })
  })

  describe('Cookie と攻撃者に見えるもの', () => {
    it('http では Secure の SID を付けず lang だけ。https では両方。サブドメインには lang だけ', () => {
      expect(field(byId(build(), 'http-request'), 'Cookie')).toBe('lang=en-US')
      expect(field(byId(build('known'), 'request'), 'Cookie')).toBe(
        'SID=31d4d96e407aad42; lang=en-US',
      )
      expect(field(byId(build('subdomain'), 'request'), 'Cookie')).toBe('lang=en-US')
      expect(field(byId(build('preload'), 'request'), 'Cookie')).toBe('(none)')
    })

    it('攻撃者は、ストリッピングではパスワードを読み、HSTS が効けば暗号文しか読めない', () => {
      for (const situation of ['noHsts', 'expired'] as const) {
        const seen = final(build(situation)).attacker?.values.seen
        expect(JSON.stringify(seen)).toContain(PASSWORD_BODY)
      }
      for (const situation of PROTECTED) {
        expect(final(build(situation)).attacker?.values.seen).toEqual({
          columns: ['Field', 'Value'],
          rows: [['TLS records', '(ciphertext only)']],
        })
      }
    })

    it('ストリッピングでは Location と Secure が書き換えられ、サイトはセッションを攻撃者のアドレスに渡す', () => {
      const steps = build()
      expect(field(byId(steps, 'session'), 'Set-Cookie')).toContain('Secure')
      expect(field(byId(steps, 'session'), 'Location')).toBe('https://example.com/')
      expect(field(byId(steps, 'relay-303'), 'Set-Cookie')).not.toContain('Secure')
      expect(field(byId(steps, 'relay-303'), 'Location')).toBe('http://example.com/')
      expect(final(steps).site?.values.login).toBe('alice (from 198.51.100.66)')
      // http で届いた Secure のない SID は、既存の Secure の SID を上書きできない（rfc6265bis §5.7 手順 16）
      expect(final(steps).browser?.values.cookies).toEqual({
        columns: ['Name', 'Value', 'Secure'],
        rows: [
          ['SID', '31d4d96e407aad42', 'yes'],
          ['lang', 'en-US', 'no'],
        ],
      })
    })
  })
})
