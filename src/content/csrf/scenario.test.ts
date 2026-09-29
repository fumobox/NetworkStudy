// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { attachDecision, sameSiteFlag } from './cookies'
import { CSRF_TOKEN, csrfScenario, SESSION_ID, type CsrfOptions } from './scenario'

const handle = toScenarioHandle(csrfScenario)
const SITUATIONS = ['none', 'lax', 'strict', 'laxGet', 'token', 'fetchMetadata'] as const

const build = (situation: CsrfOptions['situation'] = 'none') =>
  csrfScenario.buildSteps({ situation })

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
const final = (steps: readonly Step[]) =>
  deriveState(csrfScenario.actors, steps, steps.length - 1).actorStates

const OPENING = [
  'browser→bank POST /login delivered',
  'bank→browser 303 See Other (Set-Cookie: sid) delivered',
  'browser→bank GET /account delivered',
  'bank→browser 200 OK (account page) delivered',
  'browser→evil GET /win delivered',
]
const FORM_PAGE = 'evil→browser 200 OK (page with a hidden form) delivered'
const ATTACK = 'browser→bank POST /transfer (from evil.example)'

describe('csrfScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'token' }).options).toEqual({ situation: 'token' })
    expect(handle.resolve({ situation: 'xss' }).options).toEqual({ situation: 'none' })
  })

  it('ラベルは 40 文字以内で、タイマーは使わない', () => {
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      expect(Math.max(...messages(steps).map((m) => m.label.length))).toBeLessThanOrEqual(40)
      expect(steps.flatMap((s) => s.events).some((e) => e.kind === 'timer')).toBe(false)
    }
  })

  describe('流れ', () => {
    it('SameSite=None: Cookie が付き、送金される', () => {
      expect(flow(build())).toEqual([
        ...OPENING,
        FORM_PAGE,
        `${ATTACK} delivered`,
        'bank→browser 200 OK (transfer done) delivered',
      ])
    })

    it('Lax: POST には付かずに断られ、リンクの GET には付く', () => {
      expect(flow(build('lax'))).toEqual([
        ...OPENING,
        FORM_PAGE,
        `${ATTACK} rejected`,
        'bank→browser 403 Forbidden delivered',
        'browser→bank GET /account (link on evil.example) delivered',
        'bank→browser 200 OK (account page) delivered',
      ])
    })

    it('Strict: リンクでもログアウトした状態になる', () => {
      const steps = build('strict')
      expect(flow(steps).slice(-2)).toEqual([
        'browser→bank GET /account (link on evil.example) delivered',
        'bank→browser 200 OK (login page) delivered',
      ])
      expect(field(byId(steps, 'link'), 'Cookie')).toBe('(not sent)')
    })

    it('Lax でも、GET で送金できれば通ってしまう', () => {
      const steps = build('laxGet')
      expect(flow(steps).slice(-3)).toEqual([
        'evil→browser 200 OK (page with a redirect script) delivered',
        'browser→bank GET /transfer?to=mallory&amount=1000 delivered',
        'bank→browser 200 OK (transfer done) delivered',
      ])
      const attack = byId(steps, 'attack')
      expect(field(attack, 'Cookie')).toBe(`sid=${SESSION_ID}`)
      expect(field(attack, 'Origin')).toBeUndefined()
      expect(field(attack, 'Sec-Fetch-Site')).toBe('cross-site')
    })

    it('CSRF トークンと Fetch Metadata: Cookie は付くが断られる', () => {
      for (const situation of ['token', 'fetchMetadata'] as const) {
        const steps = build(situation)
        expect(flow(steps).slice(-2)).toEqual([
          `${ATTACK} rejected`,
          'bank→browser 403 Forbidden delivered',
        ])
        expect(field(byId(steps, 'attack'), 'Cookie')).toBe(`sid=${SESSION_ID}`)
      }
      expect(field(byId(build('token'), 'attack'), 'csrf')).toBe('(missing)')
      expect(field(byId(build('token'), 'account-page'), 'Body')).toContain(CSRF_TOKEN)
    })
  })

  describe('Cookie とヘッダー', () => {
    it('攻撃の要求の Cookie は、SameSite の規則（草案 §5.8.3）の結果と同じ', () => {
      const flags = {
        none: 'None',
        lax: 'Lax',
        strict: 'Strict',
        laxGet: 'Lax',
        token: 'None',
        fetchMetadata: 'None',
      } as const
      for (const situation of SITUATIONS) {
        const attack = byId(build(situation), 'attack')
        const decision = attachDecision({
          flag: sameSiteFlag(flags[situation]),
          sameSiteRequest: false,
          method: situation === 'laxGet' ? 'GET' : 'POST',
          topLevel: true,
        })
        expect(field(attack, 'Cookie')).toBe(
          decision === 'sent' ? `sid=${SESSION_ID}` : '(not sent)',
        )
      }
    })

    it('Set-Cookie は Secure・HttpOnly と状況ごとの SameSite', () => {
      expect(field(byId(build(), 'session'), 'Set-Cookie')).toBe(
        'sid=3f9a1c; Path=/; Secure; HttpOnly; SameSite=None',
      )
      expect(field(byId(build('strict'), 'session'), 'Set-Cookie')).toBe(
        'sid=3f9a1c; Path=/; Secure; HttpOnly; SameSite=Strict',
      )
    })

    it('Origin と Sec-Fetch-Site が要求の出どころを示す', () => {
      const steps = build()
      const login = byId(steps, 'login')
      expect([field(login, 'Origin'), field(login, 'Sec-Fetch-Site')]).toEqual([
        'https://bank.example',
        'same-origin',
      ])
      expect(field(byId(steps, 'account'), 'Origin')).toBeUndefined()
      expect(field(byId(steps, 'visit-evil'), 'Sec-Fetch-Site')).toBe('none')
      expect(field(byId(steps, 'visit-evil'), 'Cookie')).toBe('(none)')
      const attack = byId(steps, 'attack')
      expect([field(attack, 'Origin'), field(attack, 'Sec-Fetch-Site')]).toEqual([
        'https://evil.example',
        'cross-site',
      ])
      // スクリプトの form.submit() にはユーザーの操作がないので Sec-Fetch-User は付かない
      expect(field(attack, 'Sec-Fetch-User')).toBeUndefined()
      expect(field(byId(build('lax'), 'link'), 'Sec-Fetch-User')).toBe('?1')
    })
  })

  describe('結果', () => {
    it('残高が 0 になるのは None と、GET で送金できる Lax だけ', () => {
      const balances = SITUATIONS.map((situation) => final(build(situation)).bank?.values.balance)
      expect(balances).toEqual(['0 USD', '1000 USD', '1000 USD', '0 USD', '1000 USD', '1000 USD'])
      expect(SITUATIONS.map((situation) => final(build(situation)).bank?.values.transfer)).toEqual([
        'transferred (to mallory)',
        '403 (no session)',
        '403 (no session)',
        'transferred (to mallory)',
        '403 (csrf missing)',
        '403 (cross-site)',
      ])
    })

    it('Cookie の保存場所とセッションの表', () => {
      const { browser, bank } = final(build('token'))
      expect(browser?.values.cookieJar).toEqual({
        columns: ['Name', 'Value', 'Domain', 'Path', 'SameSite', 'Secure', 'HttpOnly'],
        rows: [['sid', SESSION_ID, 'bank.example (host-only)', '/', 'None', 'yes', 'yes']],
      })
      expect(bank?.values.sessions).toEqual({
        columns: ['Session', 'User', 'CSRF token'],
        rows: [[SESSION_ID, 'alice', CSRF_TOKEN]],
      })
    })
  })
})
