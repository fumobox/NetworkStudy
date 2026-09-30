/**
 * OAuth 2.0 の認可コードフロー（PKCE 付き）と OpenID Connect の ID トークン
 *
 * 根拠:
 * - RFC 6749: §1.3.1（コードフローはトークンをブラウザーに通さない）、§2.1（コンフィデンシャルクライアント）、§2.3.1
 *   （client_secret_basic）、§3.1.2.3（redirect_uri の比較）、§4.1.1〜§4.1.4（認可要求、認可応答、トークン要求と応答。
 *   コードは 1 回だけ、10 分以内を勧める）、§5.1（Cache-Control: no-store、Pragma: no-cache）、§5.2（invalid_grant）、
 *   §6（リフレッシュ）、§10.12（state と CSRF）。例の値（client_id、client_secret、code、refresh_token）も RFC 6749 から
 * - RFC 7636（PKCE）: §4.1〜§4.6、付録 B（code_verifier と code_challenge の例）。pkce.ts、sha256.ts
 * - RFC 9700（OAuth 2.0 Security BCP、BCP 240）: §2.1（redirect_uri の完全一致、iss）、§2.1.1（パブリッククライアントは PKCE 必須、
 *   コンフィデンシャルクライアントには推奨）、§3（攻撃者 A3: 認可応答を読める）、§4.5（認可コードの注入）、§4.5.2（コードは 1 回だけ
 *   使えるので、正しいクライアントより先に使う必要がある）、§4.5.3.1・§4.5.3.2（PKCE と nonce で防ぐ）、§4.7（CSRF）、
 *   §4.14.2（リフレッシュトークンのローテーション）
 * - RFC 9207 §2（認可応答の iss）、RFC 6750 §2.1・§3・§3.1（Bearer、WWW-Authenticate、invalid_token は 401）
 * - RFC 9068 §2.1・§2.2・§4（JWT のアクセストークン、typ at+jwt）、RFC 7519（JWT、NumericDate）。jwt.ts
 * - OpenID Connect Core 1.0（errata set 2）: §2（ID トークンのクレーム）、§3.1.2.1（scope に openid、nonce、state）、
 *   §3.1.3.3（token_type は Bearer）、§3.1.3.7（ID トークンの確かめ）。例の値（state、nonce、sub）も OIDC Core から
 * - RFC 2606（example.com / .net / .org）
 *
 * 学習用の単純化: クライアントは Web アプリのバックエンド（コンフィデンシャル）。ログインと同意は 1 回の POST にまとめる
 * （RFC 6749 §3.1 は利用者の認証の方法を決めない）。署名は計算せず、JWT の 3 つ目の部分は「(signature)」で示す。
 * 認可サーバーの鍵（jwks_uri）の取得、Discovery、TLS・DNS・TCP は描かない。noPkce ではコードが漏れる経路は描かず、
 * 説明にとどめる。時刻は 2026-10-01T09:00:00Z から
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  MessageStatus,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { clientSecretBasic } from './encoding'
import {
  jwtSegments,
  numericDate,
  validateAccessToken,
  validateIdToken,
  type AccessTokenClaims,
  type IdTokenClaims,
} from './jwt'
import { codeChallengeS256, verifyCodeVerifier } from './pkce'
import { redeemCode, type CodeRecord } from './tokenEndpoint'

const SITUATIONS = ['normal', 'stateMismatch', 'noPkce', 'expired'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('normal'),
})
export type OauthOptions = z.infer<typeof optionsSchema>
type Situation = OauthOptions['situation']

const BROWSER: ActorId = 'browser'
const CLIENT: ActorId = 'client'
const AS: ActorId = 'as'
const RS: ActorId = 'rs'
const ATTACKER: ActorId = 'attacker'

const PAGE: StateKey = 'page'
const SEEN: StateKey = 'seen'
const SESSIONS: StateKey = 'sessions'
const CHECK: StateKey = 'check'
const ID_TOKEN: StateKey = 'idToken'
const TOKENS: StateKey = 'tokens'
const CODES: StateKey = 'codes'
const REFRESH: StateKey = 'refresh'
const DECISION: StateKey = 'decision'
const RS_CHECK: StateKey = 'rsCheck'
const HOLDS: StateKey = 'holds'

export const SEEN_COLUMNS = ['Value', 'Where'] as const
export const SESSION_COLUMNS = ['Session', 'state', 'code_verifier', 'nonce', 'User'] as const
export const ID_TOKEN_COLUMNS = ['Claim', 'Value', 'Check'] as const
export const TOKEN_COLUMNS = ['Token', 'Value', 'Expires'] as const
export const CODE_COLUMNS = ['code', 'client_id', 'code_challenge', 'User', 'Used'] as const
export const REFRESH_COLUMNS = ['Refresh token', 'Status'] as const
export const RS_CHECK_COLUMNS = ['Check', 'Result'] as const

const CLIENT_HOST = 'client.example.com'
const AS_HOST = 'as.example.net'
const API_HOST = 'api.example.org'
const ISSUER = `https://${AS_HOST}`
const API = `https://${API_HOST}`
const REDIRECT_URI = `https://${CLIENT_HOST}/cb`
const SCOPE = 'openid profile photos.read'

/** 例の値。client_id・client_secret・code・refresh_token は RFC 6749、state・nonce・sub は OIDC Core、code_verifier は RFC 7636 付録 B */
export const VALUES = {
  clientId: 's6BhdRkqt3',
  clientSecret: 'gX1fBat3bV',
  state: 'af0ifjsldkj',
  nonce: 'n-0S6_WzA2Mj',
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  code: 'SplxlOBeZQQYbYS6WxSbIA',
  refresh: 'tGzv3JOkF0XG5Qx2TlKWIA',
  rotatedRefresh: 'kq7Vp2NbWc4YxE1sTlaZ0Q',
  sub: '24400320',
  sid: 'c1e7a9',
  malloryState: 'xk9Q2vL0bTe',
  malloryVerifier: 'Qm4lL0ry-v3rIfIeR_7kZ2xW9pN5cT1sH8aY6dF0gJq',
  mallorySid: 'm4l0ry',
  malloryCode: 'Mc0dE7yQ1rPaKzX0',
} as const

const CHALLENGE = codeChallengeS256(VALUES.verifier)
const MALLORY_CHALLENGE = codeChallengeS256(VALUES.malloryVerifier)
const BASIC = clientSecretBasic(VALUES.clientId, VALUES.clientSecret)
const NOW = numericDate('2026-10-01T09:00:00Z')
const LIFETIME_S = 3600
/** 期限切れの後、リフレッシュする時刻（10:05） */
const REFRESH_AT = NOW + LIFETIME_S + 300
const KID = '2026-09-k1'

/** ID トークンのクレーム。nonce は認可要求で送ったときだけ入る（OIDC Core §2） */
const idClaims = (withNonce: boolean): IdTokenClaims => ({
  iss: ISSUER,
  sub: VALUES.sub,
  aud: VALUES.clientId,
  exp: NOW + LIFETIME_S,
  iat: NOW,
  ...(withNonce ? { nonce: VALUES.nonce } : {}),
})
const idToken = (claims: IdTokenClaims) =>
  `${jwtSegments({ alg: 'RS256', kid: KID }, claims)}.(signature)`

const accessClaims = (iat: number, jti: string): AccessTokenClaims => ({
  iss: ISSUER,
  sub: VALUES.sub,
  aud: API,
  client_id: VALUES.clientId,
  exp: iat + LIFETIME_S,
  iat,
  jti,
  scope: SCOPE,
})
const AT_HEADER = { typ: 'at+jwt', alg: 'RS256', kid: KID }
const accessToken = (claims: AccessTokenClaims) => `${jwtSegments(AT_HEADER, claims)}.(signature)`
const FIRST_ACCESS = accessClaims(NOW, '7f9b2c1e')
const SECOND_ACCESS = accessClaims(REFRESH_AT, 'c3d8e6a0')

/** 表に出す時刻（UTC） */
const clock = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000', '')
const short = (token: string) => `${token.slice(0, 12)}…`

// ---------- 状態 ----------

const tableOf =
  (columns: readonly string[]) =>
  (rows: readonly (readonly string[])[]): StateTable => ({ columns, rows })
const seenTable = tableOf(SEEN_COLUMNS)
const sessionTable = tableOf(SESSION_COLUMNS)
const idTokenTable = tableOf(ID_TOKEN_COLUMNS)
const tokenTable = tableOf(TOKEN_COLUMNS)
const codeTable = tableOf(CODE_COLUMNS)
const refreshTable = tableOf(REFRESH_COLUMNS)
const rsCheckTable = tableOf(RS_CHECK_COLUMNS)

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: 'Alice’s browser', ja: 'アリスのブラウザー' },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: PAGE, label: { en: 'Page in the tab', ja: 'タブのページ' }, initial: '-' },
      {
        key: SEEN,
        label: {
          en: 'Values that passed through the browser',
          ja: 'ブラウザーを通った値',
        },
        initial: seenTable([]),
      },
    ],
  },
  {
    id: CLIENT,
    kind: 'server',
    name: {
      en: 'Client backend (client.example.com)',
      ja: 'クライアントのバックエンド（client.example.com）',
    },
    shortName: { en: 'Client', ja: 'クライアント' },
    stateSlots: [
      {
        key: SESSIONS,
        label: { en: 'Sessions', ja: 'セッション' },
        initial: sessionTable([]),
      },
      { key: CHECK, label: { en: 'Callback check', ja: 'コールバックの確かめ' }, initial: '-' },
      {
        key: ID_TOKEN,
        label: { en: 'ID token checks', ja: 'ID トークンの確かめ' },
        initial: idTokenTable([]),
      },
      {
        key: TOKENS,
        label: { en: 'Tokens it holds', ja: '持っているトークン' },
        initial: tokenTable([]),
      },
    ],
  },
  {
    id: AS,
    kind: 'server',
    name: { en: 'Authorization server (as.example.net)', ja: '認可サーバー（as.example.net）' },
    shortName: { en: 'AS', ja: '認可サーバー' },
    stateSlots: [
      {
        key: CODES,
        label: { en: 'Authorization codes', ja: '認可コード' },
        initial: codeTable([]),
      },
      {
        key: REFRESH,
        label: { en: 'Refresh tokens', ja: 'リフレッシュトークン' },
        initial: refreshTable([]),
      },
      { key: DECISION, label: { en: 'Last decision', ja: '最後の判断' }, initial: '-' },
    ],
  },
  {
    id: RS,
    kind: 'server',
    name: { en: 'Resource server (api.example.org)', ja: 'リソースサーバー（api.example.org）' },
    shortName: { en: 'RS', ja: 'リソースサーバー' },
    stateSlots: [
      {
        key: RS_CHECK,
        label: { en: 'Access token checks', ja: 'アクセストークンの確かめ' },
        initial: rsCheckTable([]),
      },
    ],
  },
  {
    id: ATTACKER,
    kind: 'client',
    name: { en: 'Mallory (attacker)', ja: 'マロリー（攻撃者）' },
    shortName: { en: 'Mallory', ja: 'マロリー' },
    stateSlots: [
      { key: HOLDS, label: { en: 'What Mallory has', ja: 'マロリーが持つもの' }, initial: '-' },
    ],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

// ---------- メッセージ ----------

const FIELD_TEXT = {
  responseType: {
    en: 'code: the authorization code flow (RFC 6749 §4.1.1)',
    ja: 'code: 認可コードフロー（RFC 6749 §4.1.1）',
  },
  clientId: { en: 'Which client is asking', ja: 'どのクライアントが頼んでいるか' },
  redirectUri: {
    en: 'Where to send Alice back. The authorization server compares it with the registered value, character by character (RFC 9700 §2.1)',
    ja: 'アリスを戻す先。認可サーバーは、登録された値と 1 文字ずつ比べる（RFC 9700 §2.1）',
  },
  scope: {
    en: 'What the client asks for. openid makes it an OpenID Connect request',
    ja: 'クライアントが求めるもの。openid があると OpenID Connect の要求になる',
  },
  state: {
    en: 'A random value tied to Alice’s session at the client. It must come back unchanged (RFC 6749 §10.12)',
    ja: 'クライアントでのアリスのセッションに結びつけた乱数。そのまま戻ってこなければならない（RFC 6749 §10.12）',
  },
  nonce: {
    en: 'A random value the authorization server copies into the ID token (OIDC Core §3.1.2.1)',
    ja: '認可サーバーが ID トークンに写す乱数（OIDC Core §3.1.2.1）',
  },
  challenge: {
    en: 'BASE64URL(SHA256(code_verifier)). The verifier itself stays at the client (RFC 7636 §4.2)',
    ja: 'BASE64URL(SHA256(code_verifier))。code_verifier そのものはクライアントに残る（RFC 7636 §4.2）',
  },
  code: {
    en: 'The authorization code: short-lived and usable once. It passes through the browser',
    ja: '認可コード。短い時間だけ有効で、1 回だけ使える。ブラウザーを通る',
  },
  iss: {
    en: 'Who issued the response. The client compares it with the server it sent Alice to (RFC 9207)',
    ja: '応答を出したのは誰か。クライアントは、アリスを送った先のサーバーと比べる（RFC 9207）',
  },
  basic: {
    en: 'client_secret_basic: the client authenticates itself. The secret never goes through the browser',
    ja: 'client_secret_basic。クライアントが自分を認証する。秘密はブラウザーを通らない',
  },
  verifier: {
    en: 'The code_verifier the client kept for this session. The authorization server hashes it and compares',
    ja: 'クライアントがこのセッションのために取っておいた code_verifier。認可サーバーはハッシュして比べる',
  },
  noStore: {
    en: 'Token responses must not be cached (RFC 6749 §5.1)',
    ja: 'トークンの応答はキャッシュさせない（RFC 6749 §5.1）',
  },
  bearer: {
    en: 'Whoever holds a bearer token can use it (RFC 6750). It goes only to the API, over TLS',
    ja: 'Bearer トークンは持っている者が使える（RFC 6750）。TLS で、API にだけ送る',
  },
} satisfies Record<string, LocalizedText>

interface Field {
  readonly name: string
  readonly value: string
  readonly text?: LocalizedText
  readonly highlight?: boolean
}
const fields = (list: readonly Field[]): PacketField[] =>
  list.map((field) => ({
    name: field.name,
    value: field.value,
    ...(field.text === undefined ? {} : { description: field.text }),
    ...(field.highlight === true ? { highlight: true } : {}),
  }))

function http(
  id: string,
  from: ActorId,
  to: ActorId,
  label: string,
  list: readonly Field[],
  description: LocalizedText,
  status: MessageStatus = 'delivered',
): Message {
  return { id, from, to, label, status, description, fields: fields(list) }
}

interface AuthorizeParams {
  readonly state: string
  readonly challenge: string | null
  readonly nonce: boolean
}

function authorizeQuery({ state, challenge, nonce }: AuthorizeParams): [string, string][] {
  return [
    ['response_type', 'code'],
    ['client_id', VALUES.clientId],
    ['redirect_uri', REDIRECT_URI],
    ['scope', SCOPE],
    ['state', state],
    ...(nonce ? [['nonce', VALUES.nonce] satisfies [string, string]] : []),
    ...(challenge === null
      ? []
      : [
          ['code_challenge', challenge] satisfies [string, string],
          ['code_challenge_method', 'S256'] satisfies [string, string],
        ]),
  ]
}
export const authorizeUrl = (params: AuthorizeParams) =>
  `${ISSUER}/authorize?${new URLSearchParams(authorizeQuery(params)).toString()}`

const PARAM_TEXT: Readonly<Record<string, LocalizedText>> = {
  response_type: FIELD_TEXT.responseType,
  client_id: FIELD_TEXT.clientId,
  redirect_uri: FIELD_TEXT.redirectUri,
  scope: FIELD_TEXT.scope,
  state: FIELD_TEXT.state,
  nonce: FIELD_TEXT.nonce,
  code_challenge: FIELD_TEXT.challenge,
}
const HIGHLIGHTED = new Set(['state', 'nonce', 'code_challenge'])
const paramFields = (params: AuthorizeParams): Field[] =>
  authorizeQuery(params).map(([name, value]) => ({
    name,
    value,
    ...(PARAM_TEXT[name] === undefined ? {} : { text: PARAM_TEXT[name] }),
    highlight: HIGHLIGHTED.has(name),
  }))

const callbackQuery = (code: string, state: string) =>
  new URLSearchParams([
    ['code', code],
    ['state', state],
    ['iss', ISSUER],
  ]).toString()
export const callbackUrl = (code: string, state: string) =>
  `${REDIRECT_URI}?${callbackQuery(code, state)}`
const callbackFields = (code: string, state: string): Field[] => [
  { name: 'code', value: code, text: FIELD_TEXT.code, highlight: true },
  { name: 'state', value: state, text: FIELD_TEXT.state, highlight: true },
  { name: 'iss', value: ISSUER, text: FIELD_TEXT.iss },
]

// ---------- 状態の値 ----------

interface Session {
  readonly sid: string
  readonly state: string
  readonly verifier: string | null
  readonly nonce: boolean
  readonly user: string
}
const ALICE_SESSION: Session = {
  sid: VALUES.sid,
  state: VALUES.state,
  verifier: VALUES.verifier,
  nonce: true,
  user: '-',
}
const sessionRow = (s: Session): string[] => [
  s.sid,
  s.state,
  s.verifier ?? '-',
  s.nonce ? VALUES.nonce : '-',
  s.user,
]
const ALICE = `alice (sub ${VALUES.sub})`

const aliceCode = (challenge: string | null, used: boolean): CodeRecord => ({
  code: VALUES.code,
  clientId: VALUES.clientId,
  redirectUri: REDIRECT_URI,
  codeChallenge: challenge,
  user: 'alice',
  expiresAt: NOW + 600,
  used,
})
const codeRow = (record: CodeRecord): string[] => [
  record.code,
  record.clientId,
  record.codeChallenge ?? '-',
  record.user,
  record.used ? 'yes' : 'no',
]

const SECTIONS = {
  client: { en: 'Starting at the client', ja: 'クライアントで始める' },
  as: { en: 'At the authorization server', ja: '認可サーバーで' },
  back: { en: 'Back at the client', ja: 'クライアントに戻る' },
  api: { en: 'Calling the API', ja: 'API を呼ぶ' },
  mallory: { en: 'Mallory', ja: 'マロリー' },
  later: { en: 'An hour later', ja: '1 時間後' },
} satisfies Record<string, LocalizedText>

type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

// ---------- 共通のステップ ----------

/** アリスがクライアントで「ログイン」を押し、認可サーバーへ送られる */
function startStep(params: AuthorizeParams): StepBody {
  const pkce = params.challenge !== null
  const session: Session = {
    ...ALICE_SESSION,
    verifier: pkce ? VALUES.verifier : null,
    nonce: params.nonce,
  }
  return {
    id: 'start',
    title: {
      en: 'Alice clicks “Log in with as.example.net”',
      ja: 'アリスが「as.example.net でログイン」を押す',
    },
    description: pkce
      ? {
          en: `The client creates a session for Alice and stores three random values in it: state, nonce and code_verifier. It sends the browser to the authorization server with state, nonce and the code_challenge (${CHALLENGE}), which is the SHA-256 of the verifier. The verifier itself stays at the client. The session cookie is SameSite=Lax, because Alice will come back through a top-level navigation from another site (see the CSRF theme).`,
          ja: `クライアントはアリスのセッションを作り、3 つの乱数を入れる。state、nonce、code_verifier。ブラウザーを、state と nonce と code_challenge（code_verifier の SHA-256、${CHALLENGE}）を付けて認可サーバーへ送る。code_verifier そのものはクライアントに残る。セッションの Cookie は SameSite=Lax。アリスは別のサイトからのトップレベルのナビゲーションで戻ってくるから（CSRF のテーマを参照）。`,
        }
      : {
          en: 'This client is an older integration: it sends state, but no code_challenge and no nonce. RFC 9700 requires every client to protect its codes with PKCE or, for OpenID Connect, the nonce. For a confidential client like this one PKCE is only recommended (it is required for public clients), but this client uses neither. The authorization server does not insist, so the request goes through.',
          ja: 'このクライアントは古い作りで、state は送るが、code_challenge も nonce も送らない。RFC 9700 は、どのクライアントにも、PKCE か（OpenID Connect なら）nonce でコードを守ることを求める。このようなコンフィデンシャルクライアントには PKCE は推奨にとどまる（パブリッククライアントには必須）が、このクライアントはどちらも使わない。認可サーバーも求めないので、要求は通る。',
        },
    events: [
      send(
        http(
          'login',
          BROWSER,
          CLIENT,
          'GET /login',
          [
            { name: 'Request line', value: 'GET /login HTTP/1.1' },
            { name: 'Host', value: CLIENT_HOST },
          ],
          {
            en: 'Alice starts logging in at the client.',
            ja: 'アリスがクライアントでログインを始める。',
          },
        ),
      ),
      set(CLIENT, SESSIONS, sessionTable([sessionRow(session)])),
      send(
        http(
          'to-as',
          CLIENT,
          BROWSER,
          `302 Found → ${AS_HOST}`,
          [
            { name: 'Status line', value: 'HTTP/1.1 302 Found' },
            { name: 'Location', value: authorizeUrl(params) },
            {
              name: 'Set-Cookie',
              value: `sid=${VALUES.sid}; Path=/; Secure; HttpOnly; SameSite=Lax`,
            },
          ],
          {
            en: 'A redirect to the authorization endpoint. Everything in this URL passes through the browser, and can end up in its history.',
            ja: '認可エンドポイントへのリダイレクト。この URL の中身はすべてブラウザーを通り、履歴に残ることもある。',
          },
        ),
      ),
      set(BROWSER, PAGE, `https://${CLIENT_HOST}/login`),
      set(
        BROWSER,
        SEEN,
        seenTable([
          [`state=${params.state}`, `URL to ${AS_HOST}`],
          ...(params.nonce ? [[`nonce=${VALUES.nonce}`, `URL to ${AS_HOST}`]] : []),
          ...(pkce ? [[`code_challenge=${short(CHALLENGE)}`, `URL to ${AS_HOST}`]] : []),
        ]),
      ),
    ],
  }
}

function authorizeStep(params: AuthorizeParams): StepBody {
  return {
    id: 'authorize',
    title: { en: 'The authorization server asks Alice', ja: '認可サーバーがアリスに尋ねる' },
    description: {
      en: `The authorization server checks that client_id is registered and that redirect_uri is exactly the registered ${REDIRECT_URI}. Then it shows Alice a login and consent page: client.example.com wants to see her profile and read her photos. Alice types her password here, at the authorization server, and never at the client.`,
      ja: `認可サーバーは、client_id が登録されていることと、redirect_uri が登録された ${REDIRECT_URI} とまったく同じことを確かめる。それからアリスに、ログインと同意のページを見せる。client.example.com が、プロフィールを見て写真を読みたがっている。アリスはパスワードを、クライアントではなくここ、認可サーバーで入力する。`,
    },
    events: [
      send(
        http(
          'authorize',
          BROWSER,
          AS,
          'GET /authorize',
          [
            { name: 'Request line', value: 'GET /authorize?… HTTP/1.1' },
            { name: 'Host', value: AS_HOST },
            ...paramFields(params),
          ],
          {
            en: 'The authorization request (RFC 6749 §4.1.1), with its query parameters.',
            ja: '認可要求（RFC 6749 §4.1.1）。クエリのパラメーターを並べる。',
          },
        ),
      ),
      set(AS, DECISION, 'redirect_uri: exact match'),
      send(
        http(
          'login-page',
          AS,
          BROWSER,
          '200 OK (login and consent)',
          [
            { name: 'Status line', value: 'HTTP/1.1 200 OK' },
            {
              name: 'Body',
              value: `Log in to ${AS_HOST}. Allow ${CLIENT_HOST} to see your profile and read your photos?`,
            },
          ],
          { en: 'The login and consent page.', ja: 'ログインと同意のページ。' },
        ),
      ),
      set(BROWSER, PAGE, `${ISSUER}/authorize`),
    ],
  }
}

function loginStep(params: AuthorizeParams): StepBody {
  const record = aliceCode(params.challenge, false)
  return {
    id: 'consent',
    title: {
      en: 'Alice logs in and allows: the code comes back',
      ja: 'アリスがログインして許す: コードが戻る',
    },
    description: {
      en: 'The authorization server creates an authorization code and remembers what it belongs to: the client, the redirect_uri, Alice, and the code_challenge. It sends the browser back to the client with the code, the same state, and iss. The code is only useful together with the client’s credentials (and the code_verifier), and it expires in 10 minutes.',
      ja: '認可サーバーは認可コードを作り、それが何に結びつくかを覚える。クライアント、redirect_uri、アリス、code_challenge。ブラウザーを、コードと同じ state と iss を付けてクライアントへ戻す。コードは、クライアントの資格情報（と code_verifier）がなければ役に立たず、10 分で切れる。',
    },
    events: [
      send(
        http(
          'login-post',
          BROWSER,
          AS,
          'POST /login',
          [
            { name: 'Request line', value: 'POST /login HTTP/1.1' },
            { name: 'Host', value: AS_HOST },
            { name: 'Body', value: 'user=alice&password=…&consent=allow' },
          ],
          {
            en: 'Alice’s password goes only to the authorization server.',
            ja: 'アリスのパスワードは認可サーバーにだけ送る。',
          },
        ),
      ),
      set(AS, CODES, codeTable([codeRow(record)])),
      send(
        http(
          'to-client',
          AS,
          BROWSER,
          `302 Found → ${CLIENT_HOST}/cb`,
          [
            { name: 'Status line', value: 'HTTP/1.1 302 Found' },
            { name: 'Location', value: callbackUrl(VALUES.code, params.state) },
            ...callbackFields(VALUES.code, params.state),
          ],
          {
            en: 'The authorization response (RFC 6749 §4.1.2, RFC 9207).',
            ja: '認可応答（RFC 6749 §4.1.2、RFC 9207）。',
          },
        ),
      ),
    ],
  }
}

const seenWithCode = (params: AuthorizeParams) =>
  seenTable([
    [`state=${params.state}`, `URL to ${AS_HOST}`],
    ...(params.nonce ? [[`nonce=${VALUES.nonce}`, `URL to ${AS_HOST}`]] : []),
    ...(params.challenge === null
      ? []
      : [[`code_challenge=${short(CHALLENGE)}`, `URL to ${AS_HOST}`]]),
    [`code=${VALUES.code}`, `URL to ${CLIENT_HOST}`],
  ])

function callbackMessage(
  id: string,
  from: ActorId,
  code: string,
  state: string,
  sid: string,
  status: MessageStatus,
  description: LocalizedText,
): Message {
  return http(
    id,
    from,
    CLIENT,
    'GET /cb?code=…',
    [
      { name: 'Request line', value: `GET /cb?${callbackQuery(code, state)} HTTP/1.1` },
      { name: 'Host', value: CLIENT_HOST },
      { name: 'Cookie', value: `sid=${sid}` },
      ...callbackFields(code, state),
    ],
    description,
    status,
  )
}

function tokenRequest(id: string, verifier: string | null): Message {
  const body = new URLSearchParams([
    ['grant_type', 'authorization_code'],
    ['code', VALUES.code],
    ['redirect_uri', REDIRECT_URI],
    ...(verifier === null ? [] : [['code_verifier', verifier] satisfies [string, string]]),
  ]).toString()
  return http(
    id,
    CLIENT,
    AS,
    'POST /token',
    [
      { name: 'Request line', value: 'POST /token HTTP/1.1' },
      { name: 'Host', value: AS_HOST },
      { name: 'Authorization', value: BASIC, text: FIELD_TEXT.basic },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
      { name: 'Body', value: body },
      ...(verifier === null
        ? [{ name: 'code_verifier', value: '(none)', highlight: true }]
        : [{ name: 'code_verifier', value: verifier, text: FIELD_TEXT.verifier, highlight: true }]),
    ],
    {
      en: 'The token request goes straight from the client’s server to the authorization server (the back channel). The browser never sees it.',
      ja: 'トークン要求は、クライアントのサーバーから認可サーバーへ直接送る（バックチャネル）。ブラウザーは見ない。',
    },
  )
}

const tokenJson = (access: AccessTokenClaims, refresh: string, claims: IdTokenClaims | null) =>
  JSON.stringify({
    access_token: short(accessToken(access)),
    token_type: 'Bearer',
    expires_in: LIFETIME_S,
    refresh_token: refresh,
    ...(claims === null ? {} : { id_token: short(idToken(claims)) }),
  })

function tokenResponse(
  id: string,
  access: AccessTokenClaims,
  refresh: string,
  claims: IdTokenClaims | null,
): Message {
  return http(
    id,
    AS,
    CLIENT,
    '200 OK (tokens)',
    [
      { name: 'Status line', value: 'HTTP/1.1 200 OK' },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Cache-Control', value: 'no-store', text: FIELD_TEXT.noStore },
      { name: 'Pragma', value: 'no-cache' },
      { name: 'Body', value: tokenJson(access, refresh, claims) },
      { name: 'access_token', value: accessToken(access), highlight: true },
      { name: 'Access token claims', value: JSON.stringify(access) },
      { name: 'refresh_token', value: refresh },
      ...(claims === null
        ? []
        : [
            { name: 'id_token', value: idToken(claims), highlight: true },
            { name: 'ID token claims', value: JSON.stringify(claims) },
          ]),
    ],
    {
      en: 'The tokens, also on the back channel. JWTs are shown decoded; the signatures are not computed on this page.',
      ja: 'トークン。これもバックチャネル。JWT は中身を開いて示す。署名は、このページでは計算しない。',
    },
  )
}

const tokenRows = (access: AccessTokenClaims, refresh: string, expired: boolean) =>
  tokenTable([
    [
      'access_token',
      short(accessToken(access)),
      expired ? `${clock(access.exp)} (expired)` : clock(access.exp),
    ],
    ['refresh_token', refresh, '-'],
  ])

const SIGNATURE_ROW = ['signature', `RS256, kid ${KID}`, 'not computed here'] as const

function tokenSteps(session: Session): StepBody[] {
  const pkce = session.verifier !== null
  const redeemed = redeemCode(
    aliceCode(pkce ? CHALLENGE : null, false),
    {
      clientId: VALUES.clientId,
      code: VALUES.code,
      redirectUri: REDIRECT_URI,
      codeVerifier: session.verifier,
    },
    NOW + 60,
  )
  const decision = redeemed.ok
    ? redeemed.pkce === 'match'
      ? 'code_verifier: S256 match'
      : 'no code_challenge on record: nothing to check'
    : `invalid_grant: ${redeemed.reason}`
  const mallory = session.sid === VALUES.mallorySid
  const claims = idClaims(session.nonce)
  const check = validateIdToken({
    claims,
    issuer: ISSUER,
    clientId: VALUES.clientId,
    nonce: session.nonce ? VALUES.nonce : null,
    now: NOW + 60,
  })
  return [
    {
      id: 'token-request',
      title: {
        en: 'The client trades the code for tokens',
        ja: 'クライアントがコードをトークンに引き換える',
      },
      description: !mallory
        ? {
            en: `The client authenticates with its client_id and secret, and sends the code, the same redirect_uri, and the code_verifier of this session. The authorization server checks that the code is unused, not expired, issued to this client for this redirect_uri, and that BASE64URL(SHA256(code_verifier)) equals the code_challenge it stored with the code. It does: ${CHALLENGE}.`,
            ja: `クライアントは client_id と秘密で自分を認証し、コード、同じ redirect_uri、このセッションの code_verifier を送る。認可サーバーは、コードが未使用で、切れておらず、このクライアントにこの redirect_uri で発行したものか、そして BASE64URL(SHA256(code_verifier)) が、コードとともに覚えた code_challenge と同じかを確かめる。同じ（${CHALLENGE}）。`,
          }
        : {
            en: `The session is Mallory’s, but the code is Alice’s. The client authenticates correctly, the code is unused and valid, and the redirect_uri matches. No code_challenge was sent with this code, so the authorization server has nothing to compare. The client secret does not help either: it proves which client is asking, not for whom.`,
            ja: `セッションはマロリーのものだが、コードはアリスのもの。クライアントは正しく自分を認証し、コードは未使用で有効で、redirect_uri も合う。このコードには code_challenge がないので、認可サーバーには比べるものがない。クライアントの秘密も役に立たない。どのクライアントが頼んでいるかはわかるが、誰のためかはわからない。`,
          },
      events: [
        send(tokenRequest('token', session.verifier)),
        set(AS, DECISION, decision),
        set(AS, CODES, codeTable([codeRow(aliceCode(pkce ? CHALLENGE : null, true))])),
      ],
    },
    {
      id: 'token-response',
      title: mallory
        ? {
            en: 'Alice’s tokens land in Mallory’s session',
            ja: 'アリスのトークンがマロリーのセッションに入る',
          }
        : { en: 'The client checks the ID token', ja: 'クライアントが ID トークンを確かめる' },
      description: mallory
        ? {
            en: 'The authorization server issues Alice’s tokens, and the client checks the ID token: iss, aud and exp are fine. The nonce would have caught the attack, because the ID token would carry Alice’s nonce and not the one in Mallory’s session, but this client did not send one. The client records Mallory’s session as Alice.',
            ja: '認可サーバーはアリスのトークンを出し、クライアントは ID トークンを確かめる。iss、aud、exp は問題ない。nonce があれば攻撃を見つけられた。ID トークンにはマロリーのセッションのものではなく、アリスの nonce が入るから。しかし、このクライアントは nonce を送っていない。クライアントは、マロリーのセッションをアリスとして記録する。',
          }
        : {
            en: 'The response carries an access token (for the API), a refresh token (for later), and an ID token (for the client: who logged in). The client checks the ID token: iss is the server it used, aud is its own client_id, it has not expired, and the nonce is the one in Alice’s session (OIDC Core §3.1.3.7). The signature could also be checked with the server’s keys; for a token received directly over TLS, OIDC allows relying on TLS instead. Alice is identified by iss and sub, not by her email address.',
            ja: '応答には、アクセストークン（API のため）、リフレッシュトークン（後のため）、ID トークン（クライアントのため。誰がログインしたか）が入っている。クライアントは ID トークンを確かめる。iss は使ったサーバー、aud は自分の client_id、期限は切れておらず、nonce はアリスのセッションのもの（OIDC Core §3.1.3.7）。署名もサーバーの鍵で確かめられる。TLS で直接受け取ったトークンなら、OIDC は TLS に頼ることを認めている。アリスは、メールアドレスではなく iss と sub で見分ける。',
          },
      events: [
        send(tokenResponse('tokens', FIRST_ACCESS, VALUES.refresh, claims)),
        set(CLIENT, ID_TOKEN, idTokenTable([...check.rows, SIGNATURE_ROW])),
        set(CLIENT, SESSIONS, sessionTable(sessionsAfterLogin(session))),
        set(CLIENT, TOKENS, tokenRows(FIRST_ACCESS, VALUES.refresh, false)),
        set(AS, REFRESH, refreshTable([[VALUES.refresh, 'active']])),
      ],
    },
  ]
}

/** ログインの後のセッション表。noPkce では、アリスのセッションはコードを受け取れないまま残る */
function sessionsAfterLogin(session: Session): string[][] {
  if (session.sid === VALUES.mallorySid) {
    return [
      sessionRow({ ...ALICE_SESSION, verifier: null, nonce: false }),
      sessionRow({ ...session, user: ALICE }),
    ]
  }
  return [sessionRow({ ...session, user: ALICE })]
}

function homeStep(to: ActorId, sid: string): StepBody {
  const mallory = to === ATTACKER
  return {
    id: 'home',
    title: mallory
      ? { en: 'Mallory is logged in as Alice', ja: 'マロリーがアリスとしてログインした' }
      : { en: 'Alice is logged in', ja: 'アリスがログインした' },
    description: mallory
      ? {
          en: 'Mallory’s browser now holds a session that the client believes is Alice’s. Mallory can use the client as Alice, including her photos through the API.',
          ja: 'マロリーのブラウザーは、クライアントがアリスのものだと信じるセッションを持つ。マロリーはアリスとしてクライアントを使え、API を通じてアリスの写真にも届く。',
        }
      : {
          en: 'The client sends the browser on to /home, a common practice, so that the URL with the code does not stay in the address bar. Against leaks through Referer and history, RFC 9700 (§4.2.4, §4.3.1) relies on codes that work only once, a Referrer-Policy and no third-party content on the callback page. Look at what passed through the browser: state, nonce, the code_challenge and the code. The code_verifier, the client secret and all three tokens never did.',
          ja: 'クライアントはブラウザーを /home に送り、コードの入った URL がアドレスバーに残らないようにする。よくある作り方。Referer や履歴からの漏れに対して RFC 9700（§4.2.4、§4.3.1）が頼るのは、1 回しか使えないコード、Referrer-Policy、コールバックのページにサードパーティーのリソースを置かないこと。ブラウザーを通ったものを見る。state、nonce、code_challenge、コード。code_verifier、クライアントの秘密、3 つのトークンは、どれも通っていない。',
        },
    events: [
      send(
        http(
          'home',
          CLIENT,
          to,
          '302 Found → /home',
          [
            { name: 'Status line', value: 'HTTP/1.1 302 Found' },
            { name: 'Location', value: '/home' },
          ],
          {
            en: `Logged in (session ${sid}).`,
            ja: `ログインした（セッション ${sid}）。`,
          },
        ),
      ),
      ...(mallory
        ? [set(ATTACKER, HOLDS, `logged in as alice at ${CLIENT_HOST}`)]
        : [set(BROWSER, PAGE, `https://${CLIENT_HOST}/home`)]),
    ],
  }
}

function apiSteps(): StepBody[] {
  const check = validateAccessToken({
    typ: AT_HEADER.typ,
    claims: FIRST_ACCESS,
    issuer: ISSUER,
    audience: API,
    requiredScope: 'photos.read',
    now: NOW + 120,
  })
  return [
    {
      id: 'api-request',
      title: { en: 'The client calls the API', ja: 'クライアントが API を呼ぶ' },
      description: {
        en: 'The client sends the access token in the Authorization header (RFC 6750 §2.1). The resource server checks it locally (RFC 9068 §4): typ is at+jwt (so an ID token cannot be used here), the issuer is the right one, aud is this API, it has not expired, and the scope includes photos.read. The signature is checked with the authorization server’s published keys, fetched earlier and not drawn.',
        ja: 'クライアントは、アクセストークンを Authorization のヘッダーで送る（RFC 6750 §2.1）。リソースサーバーは、それをその場で確かめる（RFC 9068 §4）。typ は at+jwt（なので ID トークンはここでは使えない）、発行者は正しく、aud はこの API、期限は切れておらず、scope に photos.read がある。署名は、前に取っておいた認可サーバーの公開の鍵で確かめる（描かない）。',
      },
      events: [
        send(
          http(
            'api',
            CLIENT,
            RS,
            'GET /v1/photos',
            [
              { name: 'Request line', value: 'GET /v1/photos HTTP/1.1' },
              { name: 'Host', value: API_HOST },
              {
                name: 'Authorization',
                value: `Bearer ${accessToken(FIRST_ACCESS)}`,
                text: FIELD_TEXT.bearer,
                highlight: true,
              },
            ],
            {
              en: 'An API call with the access token.',
              ja: 'アクセストークンを付けた API の呼び出し。',
            },
          ),
        ),
        set(RS, RS_CHECK, rsCheckTable([...check.rows, ['signature', 'not computed here']])),
      ],
    },
    {
      id: 'api-response',
      title: { en: 'The API answers', ja: 'API が答える' },
      description: {
        en: 'The photos come back to the client, which shows them to Alice. The refresh token never goes to the resource server; it is only for the authorization server (RFC 6749 §1.5).',
        ja: '写真がクライアントに戻り、クライアントがアリスに見せる。リフレッシュトークンはリソースサーバーには決して送らない。認可サーバーのためだけのもの（RFC 6749 §1.5）。',
      },
      events: [
        send(
          http(
            'api-ok',
            RS,
            CLIENT,
            '200 OK (photos)',
            [
              { name: 'Status line', value: 'HTTP/1.1 200 OK' },
              { name: 'Body', value: '{"photos":[…]}' },
            ],
            { en: 'Alice’s photos.', ja: 'アリスの写真。' },
          ),
        ),
      ],
    },
  ]
}

const PKCE_PARAMS: AuthorizeParams = { state: VALUES.state, challenge: CHALLENGE, nonce: true }

function normalSteps(): Step[] {
  return [
    ...inSection(SECTIONS.client, [startStep(PKCE_PARAMS)]),
    ...inSection(SECTIONS.as, [authorizeStep(PKCE_PARAMS), loginStep(PKCE_PARAMS)]),
    ...inSection(SECTIONS.back, [
      {
        id: 'callback',
        title: {
          en: 'The browser brings the code to the client',
          ja: 'ブラウザーがコードをクライアントに届ける',
        },
        description: {
          en: 'The request comes with Alice’s session cookie. The client finds the session and checks that state is the value it stored there, and that iss is the server it sent Alice to. Both match, so this response belongs to the login Alice started.',
          ja: '要求にはアリスのセッションの Cookie が付いている。クライアントはセッションを見つけ、state がそこに入れた値か、iss がアリスを送った先のサーバーかを確かめる。どちらも合うので、この応答はアリスが始めたログインのもの。',
        },
        events: [
          send(
            callbackMessage(
              'callback',
              BROWSER,
              VALUES.code,
              VALUES.state,
              VALUES.sid,
              'delivered',
              {
                en: 'The browser follows the redirect back to the client.',
                ja: 'ブラウザーがリダイレクトに従ってクライアントに戻る。',
              },
            ),
          ),
          set(CLIENT, CHECK, `state OK (session ${VALUES.sid}), iss OK`),
          set(BROWSER, SEEN, seenWithCode(PKCE_PARAMS)),
          set(BROWSER, PAGE, `${REDIRECT_URI}?code=…`),
        ],
      },
      ...tokenSteps(ALICE_SESSION),
      homeStep(BROWSER, VALUES.sid),
    ]),
    ...inSection(SECTIONS.api, apiSteps()),
  ]
}

function stateMismatchSteps(): Step[] {
  const params: AuthorizeParams = {
    state: VALUES.malloryState,
    challenge: MALLORY_CHALLENGE,
    nonce: true,
  }
  const mallorySession: Session = {
    sid: VALUES.mallorySid,
    state: VALUES.malloryState,
    verifier: VALUES.malloryVerifier,
    nonce: true,
    user: '-',
  }
  return [
    ...inSection(SECTIONS.client, [startStep(PKCE_PARAMS)]),
    ...inSection(SECTIONS.as, [authorizeStep(PKCE_PARAMS)]),
    ...inSection(SECTIONS.mallory, [
      {
        id: 'mallory-start',
        title: {
          en: 'Mallory starts her own login at the same client',
          ja: 'マロリーが同じクライアントで自分のログインを始める',
        },
        description: {
          en: 'Meanwhile Mallory, who also has an account, starts a login at client.example.com from her own browser. The client gives her a session with her own state and code_verifier.',
          ja: 'その間に、アカウントを持つマロリーも、自分のブラウザーから client.example.com でログインを始める。クライアントは、マロリー自身の state と code_verifier の入ったセッションを渡す。',
        },
        events: [
          send(
            http(
              'mallory-login',
              ATTACKER,
              CLIENT,
              'GET /login',
              [
                { name: 'Request line', value: 'GET /login HTTP/1.1' },
                { name: 'Host', value: CLIENT_HOST },
              ],
              { en: 'Mallory’s own login.', ja: 'マロリー自身のログイン。' },
            ),
          ),
          set(
            CLIENT,
            SESSIONS,
            sessionTable([sessionRow(ALICE_SESSION), sessionRow(mallorySession)]),
          ),
          send(
            http(
              'mallory-to-as',
              CLIENT,
              ATTACKER,
              `302 Found → ${AS_HOST}`,
              [
                { name: 'Status line', value: 'HTTP/1.1 302 Found' },
                { name: 'Location', value: authorizeUrl(params) },
                {
                  name: 'Set-Cookie',
                  value: `sid=${VALUES.mallorySid}; Path=/; Secure; HttpOnly; SameSite=Lax`,
                },
              ],
              {
                en: 'A redirect with Mallory’s own state.',
                ja: 'マロリー自身の state を付けたリダイレクト。',
              },
            ),
          ),
        ],
      },
      {
        id: 'mallory-code',
        title: {
          en: 'Mallory gets a code for her own account, and stops',
          ja: 'マロリーが自分のアカウントのコードを得て、止める',
        },
        description: {
          en: 'Mallory logs in to the authorization server as herself (her login is not drawn). The server redirects her back with a code for her account. She does not follow the redirect. Instead she puts the callback URL in a link and gets Alice to open it.',
          ja: 'マロリーは自分として認可サーバーにログインする（ログインは描かない）。サーバーは、マロリーのアカウントのコードを付けて戻す。マロリーはリダイレクトに従わない。代わりに、コールバックの URL をリンクにして、アリスに開かせる。',
        },
        events: [
          send(
            http(
              'mallory-authorize',
              ATTACKER,
              AS,
              'GET /authorize',
              [
                { name: 'Request line', value: 'GET /authorize?… HTTP/1.1' },
                { name: 'Host', value: AS_HOST },
                ...paramFields(params),
              ],
              { en: 'Mallory’s authorization request.', ja: 'マロリーの認可要求。' },
            ),
          ),
          send(
            http(
              'mallory-callback',
              AS,
              ATTACKER,
              `302 Found → ${CLIENT_HOST}/cb`,
              [
                { name: 'Status line', value: 'HTTP/1.1 302 Found' },
                { name: 'Location', value: callbackUrl(VALUES.malloryCode, VALUES.malloryState) },
                ...callbackFields(VALUES.malloryCode, VALUES.malloryState),
              ],
              { en: 'A code for Mallory’s account.', ja: 'マロリーのアカウントのコード。' },
            ),
          ),
          set(ATTACKER, HOLDS, `code for mallory + state ${VALUES.malloryState}`),
        ],
      },
    ]),
    ...inSection(SECTIONS.back, [
      {
        id: 'forged-callback',
        title: {
          en: 'Alice’s browser brings Mallory’s code: state does not match',
          ja: 'アリスのブラウザーがマロリーのコードを届ける: state が合わない',
        },
        description: {
          en: `Alice opens Mallory’s link. Her browser sends Mallory’s code and state to the client, with Alice’s session cookie. The client compares state with the value in Alice’s session: ${VALUES.state} is not ${VALUES.malloryState}. It rejects the response. Without this check, the client would have logged Alice’s browser in as Mallory (login CSRF), and whatever Alice uploaded next would land in Mallory’s account. PKCE would also have stopped it here: the token request would carry Alice’s code_verifier, which does not match the code_challenge stored with Mallory’s code (RFC 9700 §4.7.1).`,
          ja: `アリスはマロリーのリンクを開く。ブラウザーは、マロリーのコードと state を、アリスのセッションの Cookie とともにクライアントへ送る。クライアントは state をアリスのセッションの値と比べる。${VALUES.state} は ${VALUES.malloryState} ではない。応答を拒む。この確かめがなければ、クライアントはアリスのブラウザーをマロリーとしてログインさせ（ログイン CSRF）、アリスが次に上げたものはマロリーのアカウントに入った。PKCE でもここで止まった。トークン要求にはアリスの code_verifier が入り、マロリーのコードとともに覚えた code_challenge と合わないから（RFC 9700 §4.7.1）。`,
        },
        events: [
          send(
            callbackMessage(
              'forged',
              BROWSER,
              VALUES.malloryCode,
              VALUES.malloryState,
              VALUES.sid,
              'rejected',
              {
                en: 'Mallory’s code and state, sent by Alice’s browser with Alice’s cookie.',
                ja: 'マロリーのコードと state を、アリスのブラウザーがアリスの Cookie とともに送る。',
              },
            ),
          ),
          set(
            CLIENT,
            CHECK,
            `state mismatch: expected ${VALUES.state}, got ${VALUES.malloryState}`,
          ),
          send(
            http(
              'bad-request',
              CLIENT,
              BROWSER,
              '400 Bad Request',
              [
                { name: 'Status line', value: 'HTTP/1.1 400 Bad Request' },
                { name: 'Body', value: 'state mismatch' },
              ],
              { en: 'The client refuses the response.', ja: 'クライアントは応答を拒む。' },
            ),
          ),
        ],
      },
    ]),
  ]
}

function noPkceSteps(): Step[] {
  const params: AuthorizeParams = { state: VALUES.state, challenge: null, nonce: false }
  const mallorySession: Session = {
    sid: VALUES.mallorySid,
    state: VALUES.malloryState,
    verifier: null,
    nonce: false,
    user: '-',
  }
  const aliceSession: Session = { ...ALICE_SESSION, verifier: null, nonce: false }
  // PKCE があれば: マロリーのセッションの code_verifier と、アリスのコードの code_challenge を比べることになる
  const withPkce = verifyCodeVerifier(CHALLENGE, VALUES.malloryVerifier)
  return [
    ...inSection(SECTIONS.client, [startStep(params)]),
    ...inSection(SECTIONS.mallory, [
      {
        id: 'mallory-start',
        title: {
          en: 'Mallory opens her own session at the client',
          ja: 'マロリーがクライアントで自分のセッションを開く',
        },
        description: {
          en: 'Mallory starts a login at the same client and gets a session of her own. She stops before logging in: all she needs is the session cookie.',
          ja: 'マロリーは同じクライアントでログインを始め、自分のセッションを得る。ログインする前に止める。要るのはセッションの Cookie だけ。',
        },
        events: [
          send(
            http(
              'mallory-login',
              ATTACKER,
              CLIENT,
              'GET /login',
              [
                { name: 'Request line', value: 'GET /login HTTP/1.1' },
                { name: 'Host', value: CLIENT_HOST },
              ],
              { en: 'Mallory’s own login.', ja: 'マロリー自身のログイン。' },
            ),
          ),
          set(
            CLIENT,
            SESSIONS,
            sessionTable([sessionRow(aliceSession), sessionRow(mallorySession)]),
          ),
          send(
            http(
              'mallory-to-as',
              CLIENT,
              ATTACKER,
              `302 Found → ${AS_HOST}`,
              [
                { name: 'Status line', value: 'HTTP/1.1 302 Found' },
                {
                  name: 'Location',
                  value: authorizeUrl({
                    state: VALUES.malloryState,
                    challenge: null,
                    nonce: false,
                  }),
                },
                {
                  name: 'Set-Cookie',
                  value: `sid=${VALUES.mallorySid}; Path=/; Secure; HttpOnly; SameSite=Lax`,
                },
              ],
              {
                en: 'Mallory keeps the cookie and goes no further.',
                ja: 'マロリーは Cookie を取っておき、先へ進まない。',
              },
            ),
          ),
          set(ATTACKER, HOLDS, `session ${VALUES.mallorySid} at ${CLIENT_HOST}`),
        ],
      },
    ]),
    ...inSection(SECTIONS.as, [authorizeStep(params), loginStep(params)]),
    ...inSection(SECTIONS.back, [
      {
        id: 'leak',
        title: {
          en: 'Alice’s code leaks before it reaches the client',
          ja: 'アリスのコードが、クライアントに届く前に漏れる',
        },
        description: {
          en: 'The authorization response passes through the browser, and RFC 9700 counts on attackers who can read it (attacker A3, §3). On a phone, another app can register the same redirect scheme and receive the code instead of the real app (RFC 7636 §1). On the web, a code can leak through a misconfigured redirect or a proxy log. How it leaks is not drawn here. What matters is that Mallory has the code and the client has not used it yet, because a code can be used only once (RFC 9700 §4.5.2).',
          ja: '認可応答はブラウザーを通り、RFC 9700 は、それを読める攻撃者を想定する（攻撃者 A3、§3）。スマートフォンでは、別のアプリが同じリダイレクトのスキームを登録し、本物のアプリの代わりにコードを受け取れる（RFC 7636 §1）。Web では、設定を誤ったリダイレクトやプロキシの記録からコードが漏れうる。どう漏れるかは、ここでは描かない。大事なのは、マロリーがコードを持ち、クライアントがまだ使っていないこと。コードは 1 回しか使えないから（RFC 9700 §4.5.2）。',
        },
        events: [
          send(
            callbackMessage('callback', BROWSER, VALUES.code, VALUES.state, VALUES.sid, 'lost', {
              en: 'This request never reaches the client.',
              ja: 'この要求はクライアントに届かない。',
            }),
          ),
          set(BROWSER, SEEN, seenWithCode(params)),
          set(ATTACKER, HOLDS, `session ${VALUES.mallorySid} + Alice’s code (leaked)`),
        ],
      },
      {
        id: 'inject',
        title: {
          en: 'Mallory injects Alice’s code into her own session',
          ja: 'マロリーが、アリスのコードを自分のセッションに入れる',
        },
        description: {
          en: 'Mallory sends Alice’s code to the client’s callback, with her own session cookie and her own state. state matches, because it is Mallory’s own: state protects Alice from being logged in as someone else, not the other way round.',
          ja: 'マロリーは、アリスのコードを、自分のセッションの Cookie と自分の state とともに、クライアントのコールバックに送る。state は合う。マロリー自身のものだから。state が防ぐのは、アリスが別の誰かとしてログインさせられることで、その逆ではない。',
        },
        events: [
          send(
            callbackMessage(
              'inject',
              ATTACKER,
              VALUES.code,
              VALUES.malloryState,
              VALUES.mallorySid,
              'delivered',
              {
                en: 'Alice’s code with Mallory’s session and state.',
                ja: 'アリスのコードに、マロリーのセッションと state。',
              },
            ),
          ),
          set(CLIENT, CHECK, `state OK (session ${VALUES.mallorySid}), iss OK`),
        ],
      },
      ...tokenSteps(mallorySession),
      homeStep(ATTACKER, VALUES.mallorySid),
      {
        id: 'with-pkce',
        title: { en: 'What PKCE would have done', ja: 'PKCE があれば' },
        description: {
          en: `With PKCE, Alice’s code would be stored with Alice’s code_challenge (${CHALLENGE}), and the client would send the code_verifier from Mallory’s session. Its SHA-256 is ${MALLORY_CHALLENGE}, not Alice’s challenge, so the authorization server would answer invalid_grant (RFC 7636 §4.6, RFC 9700 §4.5.3.1). A nonce in the ID token would have caught it at the client as well. If Alice’s client later tries the same code, the server must refuse it and should revoke the tokens issued with it (RFC 6749 §4.1.2), but by then Mallory has used them.`,
          ja: `PKCE があれば、アリスのコードはアリスの code_challenge（${CHALLENGE}）とともに覚えられ、クライアントはマロリーのセッションの code_verifier を送る。その SHA-256 は ${MALLORY_CHALLENGE} で、アリスの code_challenge ではないので、認可サーバーは invalid_grant を返す（RFC 7636 §4.6、RFC 9700 §4.5.3.1）。ID トークンの nonce でも、クライアントで見つけられた。アリスのクライアントが後で同じコードを使おうとすると、サーバーは拒み、そのコードで出したトークンを取り消すべきとされる（RFC 6749 §4.1.2）が、そのときにはマロリーはもう使っている。`,
        },
        events: [set(AS, DECISION, `with PKCE: S256 ${withPkce} → invalid_grant`)],
      },
    ]),
  ]
}

function expiredSteps(): Step[] {
  const expiredCheck = validateAccessToken({
    typ: AT_HEADER.typ,
    claims: FIRST_ACCESS,
    issuer: ISSUER,
    audience: API,
    requiredScope: 'photos.read',
    now: REFRESH_AT,
  })
  const renewedCheck = validateAccessToken({
    typ: AT_HEADER.typ,
    claims: SECOND_ACCESS,
    issuer: ISSUER,
    audience: API,
    requiredScope: 'photos.read',
    now: REFRESH_AT,
  })
  const bearer = (claims: AccessTokenClaims): Field => ({
    name: 'Authorization',
    value: `Bearer ${accessToken(claims)}`,
    text: FIELD_TEXT.bearer,
  })
  return [
    ...normalSteps(),
    ...inSection(SECTIONS.later, [
      {
        id: 'api-expired',
        title: {
          en: 'An hour later, the API refuses the token',
          ja: '1 時間後、API がトークンを拒む',
        },
        description: {
          en: `The access token expired at ${clock(FIRST_ACCESS.exp)} (expires_in 3600). The resource server answers 401 with WWW-Authenticate: Bearer error="invalid_token" (RFC 6750 §3.1). Short lifetimes limit the damage if a token leaks (RFC 6750 §5.2).`,
          ja: `アクセストークンは ${clock(FIRST_ACCESS.exp)} に切れた（expires_in 3600）。リソースサーバーは、WWW-Authenticate: Bearer error="invalid_token" を付けて 401 を返す（RFC 6750 §3.1）。有効期間を短くしておくと、トークンが漏れたときの害が小さい（RFC 6750 §5.2）。`,
        },
        events: [
          {
            kind: 'timer',
            actorId: CLIENT,
            name: 'expires_in',
            durationMs: (LIFETIME_S + 300) * 1000,
          },
          set(CLIENT, TOKENS, tokenRows(FIRST_ACCESS, VALUES.refresh, true)),
          send(
            http(
              'api-expired',
              CLIENT,
              RS,
              'GET /v1/photos',
              [
                { name: 'Request line', value: 'GET /v1/photos HTTP/1.1' },
                { name: 'Host', value: API_HOST },
                bearer(FIRST_ACCESS),
              ],
              { en: 'The same token as before.', ja: '前と同じトークン。' },
              'rejected',
            ),
          ),
          set(
            RS,
            RS_CHECK,
            rsCheckTable([...expiredCheck.rows, ['signature', 'not computed here']]),
          ),
          send(
            http(
              'unauthorized',
              RS,
              CLIENT,
              '401 Unauthorized',
              [
                { name: 'Status line', value: 'HTTP/1.1 401 Unauthorized' },
                {
                  name: 'WWW-Authenticate',
                  value: `Bearer realm="${API_HOST}", error="invalid_token", error_description="The access token expired"`,
                  highlight: true,
                },
              ],
              { en: 'The token has expired.', ja: 'トークンが切れた。' },
            ),
          ),
        ],
      },
      {
        id: 'refresh',
        title: {
          en: 'The client uses the refresh token: a new pair',
          ja: 'クライアントがリフレッシュトークンを使う: 新しい組',
        },
        description: {
          en: 'Without bothering Alice, the client sends the refresh token to the authorization server’s token endpoint, authenticating as before (RFC 6749 §6). It gets a new access token and, because this server rotates refresh tokens, a new refresh token; the old one is now invalid (RFC 9700 §4.14.2). If the old one is ever presented again, the server knows it was stolen and can revoke the whole grant. RFC 9700 requires rotation or sender-constraining for public clients; this confidential client could also be protected by its secret alone.',
          ja: 'アリスに手間をかけずに、クライアントはリフレッシュトークンを認可サーバーのトークンエンドポイントに送る。前と同じく自分を認証する（RFC 6749 §6）。新しいアクセストークンを受け取り、このサーバーはリフレッシュトークンをローテーションするので、新しいリフレッシュトークンも受け取る。古いものは無効になる（RFC 9700 §4.14.2）。古いものがまた使われたら、サーバーは盗まれたとわかり、認可の全体を取り消せる。RFC 9700 は、パブリッククライアントにはローテーションか送信者に結びつけることを求める。このコンフィデンシャルクライアントなら、秘密だけでも守れる。',
        },
        events: [
          send(
            http(
              'refresh-request',
              CLIENT,
              AS,
              'POST /token (refresh)',
              [
                { name: 'Request line', value: 'POST /token HTTP/1.1' },
                { name: 'Host', value: AS_HOST },
                { name: 'Authorization', value: BASIC, text: FIELD_TEXT.basic },
                { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
                {
                  name: 'Body',
                  value: `grant_type=refresh_token&refresh_token=${VALUES.refresh}`,
                  highlight: true,
                },
              ],
              {
                en: 'A refresh request on the back channel.',
                ja: 'バックチャネルでのリフレッシュの要求。',
              },
            ),
          ),
          set(
            AS,
            REFRESH,
            refreshTable([
              [VALUES.refresh, 'rotated (invalid)'],
              [VALUES.rotatedRefresh, 'active'],
            ]),
          ),
          set(AS, DECISION, 'refresh_token: active → rotated'),
          send(tokenResponse('refresh-response', SECOND_ACCESS, VALUES.rotatedRefresh, null)),
          set(CLIENT, TOKENS, tokenRows(SECOND_ACCESS, VALUES.rotatedRefresh, false)),
        ],
      },
      {
        id: 'retry',
        title: { en: 'The call succeeds with the new token', ja: '新しいトークンで呼び出しが通る' },
        description: {
          en: 'The client repeats the call with the new access token. The response to the refresh had no ID token: OpenID Connect makes it optional there, and the client already knows who Alice is.',
          ja: 'クライアントは、新しいアクセストークンで呼び出しをやり直す。リフレッシュの応答には ID トークンがなかった。OpenID Connect はそこでは省いてよいとし、クライアントはもうアリスが誰かを知っている。',
        },
        events: [
          send(
            http(
              'api-retry',
              CLIENT,
              RS,
              'GET /v1/photos',
              [
                { name: 'Request line', value: 'GET /v1/photos HTTP/1.1' },
                { name: 'Host', value: API_HOST },
                { ...bearer(SECOND_ACCESS), highlight: true },
              ],
              { en: 'The new access token.', ja: '新しいアクセストークン。' },
            ),
          ),
          set(
            RS,
            RS_CHECK,
            rsCheckTable([...renewedCheck.rows, ['signature', 'not computed here']]),
          ),
          send(
            http(
              'api-retry-ok',
              RS,
              CLIENT,
              '200 OK (photos)',
              [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                { name: 'Body', value: '{"photos":[…]}' },
              ],
              { en: 'Alice’s photos again.', ja: 'またアリスの写真。' },
            ),
          ),
        ],
      },
    ]),
  ]
}

function buildSteps(options: OauthOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    normal: normalSteps,
    stateMismatch: stateMismatchSteps,
    noPkce: noPkceSteps,
    expired: expiredSteps,
  }
  return builders[options.situation]()
}

export const oauthScenario: Scenario<OauthOptions> = {
  id: 'oauth',
  title: {
    en: 'OAuth 2.0 and OpenID Connect: the authorization code flow with PKCE',
    ja: 'OAuth 2.0 と OpenID Connect: PKCE 付きの認可コードフロー',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'normal',
          label: { en: 'The code flow with PKCE', ja: 'PKCE 付きの認可コードフロー' },
        },
        {
          value: 'stateMismatch',
          label: {
            en: 'state does not match (login CSRF)',
            ja: 'state が合わない（ログイン CSRF）',
          },
        },
        {
          value: 'noPkce',
          label: { en: 'Without PKCE: an injected code', ja: 'PKCE なし: 注入されたコード' },
        },
        {
          value: 'expired',
          label: {
            en: 'The access token expires: refresh',
            ja: 'アクセストークンが切れる: リフレッシュ',
          },
        },
      ],
      defaultValue: 'normal',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
