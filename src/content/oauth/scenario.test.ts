// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { clientSecretBasic } from './encoding'
import { authorizeUrl, callbackUrl, oauthScenario, VALUES, type OauthOptions } from './scenario'

const handle = toScenarioHandle(oauthScenario)
const SITUATIONS = ['normal', 'stateMismatch', 'noPkce', 'expired'] as const
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

const build = (situation: OauthOptions['situation'] = 'normal') =>
  oauthScenario.buildSteps({ situation })
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
  expect(index, id).toBeGreaterThanOrEqual(0)
  return deriveState(oauthScenario.actors, steps, index).actorStates
}
function rows(value: StateValue | undefined): readonly (readonly string[])[] {
  return typeof value === 'object' ? value.rows : []
}
function dictionaryStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(dictionaryStrings)
  return []
}
const text = (message: Message) => message.fields.map((f) => `${f.name}=${f.value}`).join('\n')

describe('oauthScenario', () => {
  it('すべてのオプション（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'expired' }).options).toEqual({ situation: 'expired' })
    expect(handle.resolve({ situation: 'implicit' }).options).toEqual({ situation: 'normal' })
  })

  it('ラベルは 40 文字以内で、ラベルと状態の値は画面の文言と重ならない', () => {
    const ui = new Set([...dictionaryStrings(en), ...dictionaryStrings(ja)])
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      for (const message of messages(steps)) {
        expect(message.label.length, message.label).toBeLessThanOrEqual(40)
        expect(ui.has(message.label), message.label).toBe(false)
      }
      for (const event of steps.flatMap((step) => step.events)) {
        if (event.kind === 'stateChange' && typeof event.value === 'string') {
          expect(ui.has(event.value), event.value).toBe(false)
        }
      }
    }
  })

  it('ブラウザーは code_verifier、クライアントの秘密、トークンを決して見ない（フロントチャネルとバックチャネル）', () => {
    const secrets = [VALUES.verifier, VALUES.clientSecret, 'Basic ', 'eyJ', VALUES.refresh]
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      for (const message of messages(steps)) {
        if (message.from !== 'browser' && message.to !== 'browser') continue
        for (const secret of secrets) {
          expect(text(message).includes(secret), `${message.id} ${secret}`).toBe(false)
        }
      }
      const end = deriveState(oauthScenario.actors, steps, steps.length - 1).actorStates.browser
      const seen = JSON.stringify(end?.values)
      for (const secret of secrets) {
        expect(seen.includes(secret), secret).toBe(false)
      }
    }
  })

  describe('PKCE 付きの認可コードフロー', () => {
    const steps = build('normal')

    it('ステップとメッセージの順', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'start',
        'authorize',
        'consent',
        'callback',
        'token-request',
        'token-response',
        'home',
        'api-request',
        'api-response',
      ])
      expect(flow(steps)).toEqual([
        'browser→client GET /login delivered',
        'client→browser 302 Found → as.example.net delivered',
        'browser→as GET /authorize delivered',
        'as→browser 200 OK (login and consent) delivered',
        'browser→as POST /login delivered',
        'as→browser 302 Found → client.example.com/cb delivered',
        'browser→client GET /cb?code=… delivered',
        'client→as POST /token delivered',
        'as→client 200 OK (tokens) delivered',
        'client→browser 302 Found → /home delivered',
        'client→rs GET /v1/photos delivered',
        'rs→client 200 OK (photos) delivered',
      ])
    })

    it('認可要求のパラメーター（RFC 6749 §4.1.1、RFC 7636 §4.3、OIDC Core §3.1.2.1）', () => {
      const url = new URL(field(byId(steps, 'to-as'), 'Location') ?? '')
      expect(`${url.origin}${url.pathname}`).toBe('https://as.example.net/authorize')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        response_type: 'code',
        client_id: 's6BhdRkqt3',
        redirect_uri: 'https://client.example.com/cb',
        scope: 'openid profile photos.read',
        state: 'af0ifjsldkj',
        nonce: 'n-0S6_WzA2Mj',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
      })
      const callback = new URL(field(byId(steps, 'to-client'), 'Location') ?? '')
      expect(Object.fromEntries(callback.searchParams)).toEqual({
        code: 'SplxlOBeZQQYbYS6WxSbIA',
        state: 'af0ifjsldkj',
        iss: 'https://as.example.net',
      })
    })

    it('トークン要求は client_secret_basic と code_verifier（付録 B）', () => {
      const request = byId(steps, 'token')
      expect(field(request, 'Authorization')).toBe(clientSecretBasic('s6BhdRkqt3', 'gX1fBat3bV'))
      expect(Object.fromEntries(new URLSearchParams(field(request, 'Body')))).toEqual({
        grant_type: 'authorization_code',
        code: 'SplxlOBeZQQYbYS6WxSbIA',
        redirect_uri: 'https://client.example.com/cb',
        code_verifier: VALUES.verifier,
      })
      const after = stateAt(steps, 'token-request')
      expect(after.as?.values.decision).toBe('code_verifier: S256 match')
      expect(rows(after.as?.values.codes)).toEqual([
        ['SplxlOBeZQQYbYS6WxSbIA', 's6BhdRkqt3', CHALLENGE, 'alice', 'yes'],
      ])
    })

    it('トークンの応答はキャッシュさせず、ID トークンをすべて確かめる', () => {
      const response = byId(steps, 'tokens')
      expect(field(response, 'Cache-Control')).toBe('no-store')
      expect(field(response, 'Pragma')).toBe('no-cache')
      const body: unknown = JSON.parse(field(response, 'Body') ?? '{}')
      expect(body).toMatchObject({
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: VALUES.refresh,
      })
      const checks = rows(stateAt(steps, 'token-response').client?.values.idToken)
      expect(checks.map((row) => row.filter((_, i) => i !== 1).join(' '))).toEqual([
        'iss OK',
        'aud OK',
        'exp OK',
        'iat OK',
        'nonce OK',
        'signature not computed here',
      ])
      expect(rows(stateAt(steps, 'token-response').client?.values.sessions)[0]?.[4]).toBe(
        'alice (sub 24400320)',
      )
    })

    it('リソースサーバーは Bearer の JWT を RFC 9068 §4 で確かめる', () => {
      expect(field(byId(steps, 'api'), 'Authorization')).toMatch(/^Bearer eyJ0eXAiOiJhdCtqd3Qi/)
      expect(rows(stateAt(steps, 'api-request').rs?.values.rsCheck)).toEqual([
        ['typ', 'at+jwt: OK'],
        ['iss', 'OK'],
        ['aud', 'OK'],
        ['exp', 'OK'],
        ['scope', 'photos.read: OK'],
        ['signature', 'not computed here'],
      ])
    })
  })

  describe('state が合わない', () => {
    const steps = build('stateMismatch')

    it('マロリーのコードと state をアリスのブラウザーが届け、クライアントが 400 で拒む', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'start',
        'authorize',
        'mallory-start',
        'mallory-code',
        'forged-callback',
      ])
      const forged = byId(steps, 'forged')
      expect(forged?.status).toBe('rejected')
      expect(field(forged, 'Cookie')).toBe(`sid=${VALUES.sid}`)
      expect(field(forged, 'state')).toBe(VALUES.malloryState)
      expect(stateAt(steps, 'forged-callback').client?.values.check).toBe(
        `state mismatch: expected ${VALUES.state}, got ${VALUES.malloryState}`,
      )
      expect(byId(steps, 'bad-request')?.label).toBe('400 Bad Request')
      expect(flow(steps).some((f) => f.includes('POST /token'))).toBe(false)
    })
  })

  describe('PKCE なし', () => {
    const steps = build('noPkce')

    it('認可要求に code_challenge も nonce もない', () => {
      const url = new URL(field(byId(steps, 'to-as'), 'Location') ?? '')
      expect(url.searchParams.has('code_challenge')).toBe(false)
      expect(url.searchParams.has('nonce')).toBe(false)
      expect(url.toString()).toBe(
        authorizeUrl({ state: VALUES.state, challenge: null, nonce: false }),
      )
    })

    it('漏れたアリスのコードで、マロリーのセッションがアリスになる', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'start',
        'mallory-start',
        'authorize',
        'consent',
        'leak',
        'inject',
        'token-request',
        'token-response',
        'home',
        'with-pkce',
      ])
      expect(byId(steps, 'callback')?.status).toBe('lost')
      const inject = byId(steps, 'inject')
      expect(inject?.from).toBe('attacker')
      expect(field(inject, 'code')).toBe(VALUES.code)
      expect(field(inject, 'Cookie')).toBe(`sid=${VALUES.mallorySid}`)
      expect(field(byId(steps, 'token'), 'code_verifier')).toBe('(none)')
      const after = stateAt(steps, 'token-response')
      expect(after.as?.values.decision).toBe('no code_challenge on record: nothing to check')
      expect(rows(after.client?.values.idToken)[4]).toEqual([
        'nonce',
        VALUES.nonce,
        'not requested',
      ])
      expect(rows(after.client?.values.sessions)).toEqual([
        [VALUES.sid, VALUES.state, '-', '-', '-'],
        [VALUES.mallorySid, VALUES.malloryState, '-', '-', 'alice (sub 24400320)'],
      ])
      expect(byId(steps, 'home')?.to).toBe('attacker')
      expect(stateAt(steps, 'with-pkce').as?.values.decision).toBe(
        'with PKCE: S256 mismatch → invalid_grant',
      )
    })
  })

  describe('期限切れとリフレッシュ', () => {
    const steps = build('expired')

    it('401 invalid_token の後、リフレッシュトークンをローテーションして呼び直す', () => {
      expect(steps.map((s) => s.id).slice(-3)).toEqual(['api-expired', 'refresh', 'retry'])
      expect(byId(steps, 'api-expired')?.status).toBe('rejected')
      expect(field(byId(steps, 'unauthorized'), 'WWW-Authenticate')).toContain(
        'error="invalid_token"',
      )
      expect(rows(stateAt(steps, 'api-expired').rs?.values.rsCheck)[3]).toEqual([
        'exp',
        'expired (1790848800)',
      ])
      expect(field(byId(steps, 'refresh-request'), 'Body')).toBe(
        `grant_type=refresh_token&refresh_token=${VALUES.refresh}`,
      )
      expect(byId(steps, 'refresh-request')?.to).toBe('as')
      expect(rows(stateAt(steps, 'refresh').as?.values.refresh)).toEqual([
        [VALUES.refresh, 'rotated (invalid)'],
        [VALUES.rotatedRefresh, 'active'],
      ])
      expect(field(byId(steps, 'refresh-response'), 'id_token')).toBeUndefined()
      expect(rows(stateAt(steps, 'retry').rs?.values.rsCheck)[3]).toEqual(['exp', 'OK'])
      // リフレッシュトークンはリソースサーバーに送らない（RFC 6749 §1.5）
      for (const message of messages(steps).filter((m) => m.to === 'rs')) {
        expect(text(message).includes(VALUES.refresh)).toBe(false)
        expect(text(message).includes(VALUES.rotatedRefresh)).toBe(false)
      }
    })
  })

  it('コールバックの URL は iss を含む（RFC 9207）', () => {
    expect(new URL(callbackUrl('x', 'y')).searchParams.get('iss')).toBe('https://as.example.net')
  })
})
