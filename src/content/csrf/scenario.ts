/**
 * Cookie と CSRF（SameSite、CSRF トークン、Fetch Metadata）
 *
 * 根拠:
 * - draft-ietf-httpbis-rfc6265bis-22（2025-12-01。2026 年 9 月の時点で RFC になっていない。IESG に提出済みで、RFC Editor の
 *   キューにある。RFC 6265 を置き換える予定）: §2.3（安全なメソッド、登録可能ドメイン）、§4.1.2.7（SameSite）、
 *   §5.2・§5.2.1（同じサイトの要求）、§5.6.7（SameSite の解析。未指定・不明は Default）、§5.6.7.1（Strict と Lax）、
 *   §5.6.7.2・§8.8.6（Lax-allowing-unsafe。Default の Cookie だけ、作られてから短い間だけ）、§5.7 手順 17・19
 *   （None には Secure が要る）、§5.8.3 手順 3（Cookie を付けるかどうか）、§8.2（ambient authority）、
 *   §8.8.1〜§8.8.3（多層防御、Strict の使い勝手、None が要る場面）
 * - RFC 6265 §4.1（Set-Cookie の Path・Secure・HttpOnly）、§8.2。RFC 6265 には SameSite がない
 * - HTML Standard（WHATWG、2026 年 9 月に参照）"Sites"（スキームと登録可能ドメインで比べる）、
 *   "Form submission attributes"（enctype は application/x-www-form-urlencoded・multipart/form-data・text/plain だけ）
 * - URL Standard（WHATWG）"Host miscellaneous"（public suffix、registrable domain）
 * - Fetch Standard（WHATWG）"append a request `Origin` header"（GET・HEAD 以外には、ナビゲーションでも付く）、
 *   "CORS-safelisted method"・"CORS-safelisted request-header"
 * - Fetch Metadata Request Headers（W3C Working Draft）§2.1〜§2.4（Sec-Fetch-Dest・-Mode・-Site・-User）、§3（https の宛先にだけ付く）
 * - RFC 6454 §4、§5、§7（オリジン、Origin ヘッダー）、RFC 9110 §9.2.1（安全なメソッド。安全なメソッドで副作用を起こしてはならない）、
 *   §15.4.4（303）、§15.5.4（403）、RFC 2606（example）
 * - 標準でないもの: ブラウザーの既定（Chromium は SameSite のない Cookie を Lax として扱い、2 分間の Lax+POST を一時的な措置と
 *   している。Firefox は None として扱う）、Fetch Metadata で拒む方針（このページの例）、CSRF トークンの作り方
 *   （OWASP CSRF Prevention Cheat Sheet の指針）
 *
 * 学習用の単純化: 利用者はアリス 1 人、攻撃者のページは evil.example の 1 枚。フォームは iframe ではなくトップレベルで送る
 * （サードパーティー Cookie の制限と分けるため。実際の攻撃は隠した iframe やポップアップを使うことも多い）。Cookie は sid だけで
 * Domain なし（ホストだけ）。既定の Cookie は SameSite=None; Secure を明示する（属性がないときの扱いはブラウザーで違う）。
 * 送金の後の 303 は描かず、200 を返す。TLS・TCP・DNS は描かず、Date・Content-Length・Referer・User-Agent は省く
 */
import { z } from 'zod'
import type {
  Actor,
  Message,
  MessageId,
  MessageStatus,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { attachDecision, formatSetCookie, sameSiteFlag, type AttachDecision } from './cookies'
import { isolationPolicy, originHeader, secFetchSite, type FetchSite } from './requestHeaders'
import { sameSite, serializeOrigin, type WebOrigin } from './site'

const SITUATIONS = ['none', 'lax', 'strict', 'laxGet', 'token', 'fetchMetadata'] as const
type Situation = (typeof SITUATIONS)[number]

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('none'),
})
export type CsrfOptions = z.infer<typeof optionsSchema>

const BROWSER = 'browser'
const BANK = 'bank'
const EVIL = 'evil'

const PAGE: StateKey = 'page'
const COOKIE_JAR: StateKey = 'cookieJar'
const LAST_COOKIE: StateKey = 'lastCookie'
const SESSIONS: StateKey = 'sessions'
const BALANCE: StateKey = 'balance'
const TRANSFER: StateKey = 'transfer'
export const JAR_COLUMNS = [
  'Name',
  'Value',
  'Domain',
  'Path',
  'SameSite',
  'Secure',
  'HttpOnly',
] as const
export const SESSION_COLUMNS = ['Session', 'User', 'CSRF token'] as const

export const BANK_ORIGIN: WebOrigin = { scheme: 'https', host: 'bank.example', port: null }
export const EVIL_ORIGIN: WebOrigin = { scheme: 'https', host: 'evil.example', port: null }
const BANK_URL = serializeOrigin(BANK_ORIGIN)
const EVIL_URL = serializeOrigin(EVIL_ORIGIN)
export const SESSION_ID = '3f9a1c'
export const CSRF_TOKEN = 'Jx4pQ9'
const TRANSFER_BODY = 'to=mallory&amount=1000'

/** 各状況で bank が付ける SameSite の値 */
const COOKIE_SAME_SITE: Record<Situation, 'Strict' | 'Lax' | 'None'> = {
  none: 'None',
  lax: 'Lax',
  strict: 'Strict',
  laxGet: 'Lax',
  token: 'None',
  fetchMetadata: 'None',
}

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: 'Alice’s browser', ja: 'アリスのブラウザー' },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: PAGE, label: { en: 'Page in the tab', ja: 'タブに表示中のページ' }, initial: '-' },
      {
        key: COOKIE_JAR,
        label: { en: 'Cookie jar', ja: 'Cookie の保存場所' },
        initial: { columns: JAR_COLUMNS, rows: [] },
      },
      {
        key: LAST_COOKIE,
        label: { en: 'Cookie on the last request', ja: '直前の要求の Cookie' },
        initial: '-',
      },
    ],
  },
  {
    id: BANK,
    kind: 'server',
    name: { en: 'bank.example', ja: 'bank.example' },
    stateSlots: [
      {
        key: SESSIONS,
        label: { en: 'Sessions', ja: 'セッション' },
        initial: { columns: SESSION_COLUMNS, rows: [] },
      },
      { key: BALANCE, label: { en: 'Alice’s balance', ja: 'アリスの残高' }, initial: '1000 USD' },
      {
        key: TRANSFER,
        label: { en: 'Last /transfer request', ja: '最後の /transfer への要求' },
        initial: '-',
      },
    ],
  },
  {
    id: EVIL,
    kind: 'server',
    name: { en: 'evil.example (attacker)', ja: 'evil.example（攻撃者）' },
    shortName: { en: 'evil.example', ja: 'evil.example' },
    stateSlots: [],
  },
]

const set = (actorId: string, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

const FIELD_TEXT = {
  initiator: {
    en: 'Not a header: which page or action started this request',
    ja: 'ヘッダーではない。この要求を始めたページや操作',
  },
  origin: {
    en: 'Added by the browser to requests other than GET and HEAD, including form submissions (Fetch Standard). A page cannot change it',
    ja: 'ブラウザーが GET・HEAD 以外の要求に付ける（フォームの送信も含む。Fetch Standard）。ページからは変えられない',
  },
  secFetchSite: {
    en: 'Fetch Metadata: whether the request comes from the same origin, the same site, another site, or the user directly',
    ja: 'Fetch Metadata。要求が同じオリジン・同じサイト・別のサイトのどこから来たか、利用者が直接始めたか',
  },
  cookieSent: {
    en: 'The browser attaches the cookie. It proves which browser sent the request, not that Alice meant it',
    ja: 'ブラウザーが Cookie を付ける。どのブラウザーからの要求かはわかるが、アリスが意図したかどうかはわからない',
  },
  laxWithheld: {
    en: 'SameSite=Lax: withheld, because the request is cross-site and POST is not a safe method (draft-22 §5.8.3)',
    ja: 'SameSite=Lax: 付けない。サイトをまたぐ要求で、POST は安全なメソッドではないから（草案 -22 §5.8.3）',
  },
  strictWithheld: {
    en: 'SameSite=Strict: withheld on every request that another site started (draft-22 §5.8.3)',
    ja: 'SameSite=Strict: 別のサイトが始めた要求には、いつも付けない（草案 -22 §5.8.3）',
  },
  setCookie: {
    en: 'HttpOnly keeps the cookie from scripts, and Secure sends it only over https. Neither stops CSRF. SameSite decides when other sites’ requests get it',
    ja: 'HttpOnly はスクリプトから Cookie を隠し、Secure は https でだけ送る。どちらも CSRF は防がない。別のサイトの要求に付けるかは SameSite で決まる',
  },
  csrf: {
    en: 'The CSRF token from bank’s own page. evil.example cannot read bank’s pages, so it cannot copy the token',
    ja: 'bank 自身のページに埋めた CSRF トークン。evil.example は bank のページを読めないので、トークンを写せない',
  },
} satisfies Record<string, LocalizedText>

interface RequestSpec {
  readonly id: MessageId
  readonly to: typeof BANK | typeof EVIL
  readonly label: string
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly initiator: string
  /** 要求を始めたページのオリジン。利用者が直接始めたら 'user' */
  readonly from: WebOrigin | 'user'
  readonly cookie: AttachDecision | 'absent'
  readonly cookieNote?: LocalizedText
  readonly userActivation: boolean
  readonly body?: string
  readonly extra?: readonly PacketField[]
  readonly status?: MessageStatus
}

function request(spec: RequestSpec): Message {
  const target = spec.to === BANK ? BANK_ORIGIN : EVIL_ORIGIN
  const origin =
    spec.from === 'user'
      ? undefined
      : originHeader({ method: spec.method, mode: 'navigate', initiator: spec.from, target })
  const site: FetchSite = secFetchSite(spec.from, [target])
  const cookieValue =
    spec.cookie === 'sent'
      ? `sid=${SESSION_ID}`
      : spec.cookie === 'withheld'
        ? '(not sent)'
        : '(none)'
  return {
    id: spec.id,
    from: BROWSER,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields: [
      { name: 'Initiator', value: spec.initiator, description: FIELD_TEXT.initiator },
      { name: 'Request line', value: `${spec.method} ${spec.path} HTTP/1.1` },
      { name: 'Host', value: target.host },
      ...(origin === undefined
        ? []
        : [
            {
              name: 'Origin',
              value: origin,
              highlight: origin !== serializeOrigin(target),
              description: FIELD_TEXT.origin,
            } satisfies PacketField,
          ]),
      {
        name: 'Sec-Fetch-Site',
        value: site,
        highlight: site === 'cross-site',
        description: FIELD_TEXT.secFetchSite,
      },
      { name: 'Sec-Fetch-Mode', value: 'navigate' },
      { name: 'Sec-Fetch-Dest', value: 'document' },
      // ユーザーの操作（クリックなど）がなかったナビゲーションには Sec-Fetch-User が付かない（Fetch Metadata §2.4）
      ...(spec.userActivation
        ? [{ name: 'Sec-Fetch-User', value: '?1' } satisfies PacketField]
        : []),
      {
        name: 'Cookie',
        value: cookieValue,
        highlight: spec.to === BANK && spec.from !== 'user' && !sameSite(spec.from, target),
        ...(spec.cookieNote === undefined ? {} : { description: spec.cookieNote }),
      },
      ...(spec.body === undefined
        ? []
        : [
            {
              name: 'Content-Type',
              value: 'application/x-www-form-urlencoded',
            } satisfies PacketField,
            { name: 'Body', value: spec.body } satisfies PacketField,
          ]),
      ...(spec.extra ?? []),
    ],
  }
}

function response(
  id: MessageId,
  from: typeof BANK | typeof EVIL,
  label: string,
  fields: readonly PacketField[],
): Message {
  return { id, from, to: BROWSER, label, status: 'delivered', fields: [...fields] }
}

const jarRow = (flag: 'Strict' | 'Lax' | 'None'): StateTable => ({
  columns: JAR_COLUMNS,
  rows: [['sid', SESSION_ID, 'bank.example (host-only)', '/', flag, 'yes', 'yes']],
})

const sessions = (token: boolean): StateTable => ({
  columns: SESSION_COLUMNS,
  rows: [[SESSION_ID, 'alice', token ? CSRF_TOKEN : '-']],
})

const SECTIONS = {
  bank: { en: 'Alice is on bank.example', ja: 'bank.example を開いている' },
  evil: { en: 'Alice is on evil.example', ja: 'evil.example を開いている' },
  back: { en: 'Back on evil.example', ja: 'また evil.example で' },
} satisfies Record<string, LocalizedText>

type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

/** evil.example のページが始めた要求への、Cookie を付けるかどうか（トップレベルのナビゲーション） */
function crossSiteDecision(situation: Situation, method: 'GET' | 'POST'): AttachDecision {
  return attachDecision({
    flag: sameSiteFlag(COOKIE_SAME_SITE[situation]),
    sameSiteRequest: sameSite(EVIL_ORIGIN, BANK_ORIGIN),
    method,
    topLevel: true,
  })
}

function openingSteps(situation: Situation): Step[] {
  const flag = COOKIE_SAME_SITE[situation]
  const token = situation === 'token'
  const setCookie = formatSetCookie({
    name: 'sid',
    value: SESSION_ID,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: flag,
  })
  return [
    ...inSection(SECTIONS.bank, [
      {
        id: 'login',
        title: { en: 'Alice logs in to her bank', ja: 'アリスが銀行にログインする' },
        description: {
          en: 'Alice enters her password on bank.example’s login page. The form is sent from bank.example’s own page, so the request is same-origin.',
          ja: 'アリスは bank.example のログインのページでパスワードを入力する。フォームは bank.example 自身のページから送られるので、同じオリジンの要求になる。',
        },
        events: [
          set(BROWSER, PAGE, `${BANK_URL}/login`),
          send(
            request({
              id: 'login',
              to: BANK,
              label: 'POST /login',
              method: 'POST',
              path: '/login',
              initiator: 'bank.example page',
              from: BANK_ORIGIN,
              cookie: 'absent',
              userActivation: true,
              body: 'user=alice&password=…',
            }),
          ),
        ],
      },
      {
        id: 'session',
        title: {
          en: 'bank.example sets a session cookie',
          ja: 'bank.example がセッション Cookie を設定する',
        },
        description: {
          en: `The password is right, so bank creates a session and sends its ID in a cookie${token ? ', and remembers a random CSRF token for the session' : ''}. From now on the browser sends the cookie with its requests to bank.example, and that is how bank recognizes Alice. The cookie has no Domain attribute, so it goes only to bank.example itself (host-only).`,
          ja: `パスワードが正しいので、bank はセッションを作り、その ID を Cookie で送る${token ? '。セッションには乱数の CSRF トークンも覚えておく' : ''}。以後ブラウザーは bank.example への要求にこの Cookie を付け、bank はそれでアリスだとわかる。Domain 属性がないので、Cookie は bank.example 自身にだけ送られる（ホストだけ）。`,
        },
        events: [
          send(
            response('session', BANK, '303 See Other (Set-Cookie: sid)', [
              { name: 'Status line', value: 'HTTP/1.1 303 See Other' },
              { name: 'Location', value: '/account' },
              {
                name: 'Set-Cookie',
                value: setCookie,
                highlight: true,
                description: FIELD_TEXT.setCookie,
              },
            ]),
          ),
          set(BROWSER, COOKIE_JAR, jarRow(flag)),
          set(BANK, SESSIONS, sessions(token)),
        ],
      },
      {
        id: 'account',
        title: { en: 'Logged in', ja: 'ログインできた' },
        description: token
          ? {
              en: `The browser follows the redirect with the cookie, and bank shows Alice’s account. Every form on bank’s pages now carries the session’s CSRF token (${CSRF_TOKEN}) in a hidden field.`,
              ja: `ブラウザーは Cookie を付けてリダイレクトに従い、bank はアリスの口座を表示する。bank のページのフォームには、セッションの CSRF トークン（${CSRF_TOKEN}）が隠しフィールドで入っている。`,
            }
          : {
              en: 'The browser follows the redirect with the cookie, and bank shows Alice’s account. A GET navigation carries no Origin header.',
              ja: 'ブラウザーは Cookie を付けてリダイレクトに従い、bank はアリスの口座を表示する。GET のナビゲーションには Origin ヘッダーが付かない。',
            },
        events: [
          send(
            request({
              id: 'account',
              to: BANK,
              label: 'GET /account',
              method: 'GET',
              path: '/account',
              initiator: 'redirect from /login',
              from: BANK_ORIGIN,
              cookie: 'sent',
              userActivation: true,
            }),
          ),
          send(
            response('account-page', BANK, '200 OK (account page)', [
              { name: 'Status line', value: 'HTTP/1.1 200 OK' },
              {
                name: 'Body',
                value: token
                  ? `… <form method="POST" action="/transfer"><input type="hidden" name="csrf" value="${CSRF_TOKEN}"> …`
                  : '… <form method="POST" action="/transfer"> …',
              },
            ]),
          ),
          set(BROWSER, PAGE, `${BANK_URL}/account`),
          set(BROWSER, LAST_COOKIE, 'sid sent'),
        ],
      },
    ]),
    ...inSection(SECTIONS.evil, [
      {
        id: 'visit-evil',
        title: { en: 'Alice opens a link from an email', ja: 'アリスがメールのリンクを開く' },
        description: {
          en: 'Later, still logged in, Alice opens a link in her email app: https://evil.example/win. It comes from outside the browser, so Sec-Fetch-Site is none. The browser never sends bank’s cookie to evil.example, and evil.example cannot read it either.',
          ja: 'しばらくして、ログインしたまま、アリスはメールのアプリでリンク https://evil.example/win を開く。ブラウザーの外から開いたので、Sec-Fetch-Site は none。ブラウザーは bank の Cookie を evil.example に送ることはなく、evil.example もそれを読めない。',
        },
        events: [
          send(
            request({
              id: 'visit-evil',
              to: EVIL,
              label: 'GET /win',
              method: 'GET',
              path: '/win',
              initiator: 'user (link in an email app)',
              from: 'user',
              cookie: 'absent',
              userActivation: true,
            }),
          ),
          set(BROWSER, LAST_COOKIE, 'no cookie for evil.example'),
        ],
      },
      {
        id: 'evil-page',
        title:
          situation === 'laxGet'
            ? { en: 'A page that jumps to bank.example', ja: 'bank.example に飛ぶページ' }
            : { en: 'A page with a hidden form', ja: '隠しフォームのあるページ' },
        description:
          situation === 'laxGet'
            ? {
                en: 'The page’s script sends the browser to a bank URL that transfers money. Changing location is a top-level GET navigation.',
                ja: 'ページのスクリプトは、ブラウザーを送金する bank の URL に移す。location を変えるのは、トップレベルの GET のナビゲーション。',
              }
            : {
                en: 'The page contains a form that posts to bank.example/transfer, with the attacker’s account and an amount filled in, and a script that submits it as soon as the page loads. A form can be sent to any site; that is ordinary HTML. It uses a form encoding, so no CORS preflight is needed.',
                ja: 'ページには、攻撃者の口座と金額を入れた bank.example/transfer への POST のフォームと、読み込むとすぐに送信するスクリプトがある。フォームはどのサイトにでも送れる。普通の HTML の働き。フォームの形式なので、CORS のプリフライトも要らない。',
              },
        events: [
          send(
            response(
              'evil-page',
              EVIL,
              situation === 'laxGet'
                ? '200 OK (page with a redirect script)'
                : '200 OK (page with a hidden form)',
              [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                {
                  name: 'Body',
                  value:
                    situation === 'laxGet'
                      ? `<script>location = "${BANK_URL}/transfer?${TRANSFER_BODY}"</script>`
                      : `<form method="POST" action="${BANK_URL}/transfer"> to=mallory amount=1000 … <script>form.submit()</script>`,
                  highlight: true,
                },
              ],
            ),
          ),
          set(BROWSER, PAGE, `${EVIL_URL}/win`),
        ],
      },
    ]),
  ]
}

const TRANSFER_DONE: PacketField[] = [
  { name: 'Status line', value: 'HTTP/1.1 200 OK' },
  { name: 'Body', value: 'Sent 1000 USD to mallory.' },
]

const forbidden = (reason: string): PacketField[] => [
  { name: 'Status line', value: 'HTTP/1.1 403 Forbidden', highlight: true },
  { name: 'Body', value: reason },
]

/** evil.example のフォームが送る POST /transfer */
function attackPost(situation: Situation, cookie: AttachDecision, status: MessageStatus): Message {
  const note =
    cookie === 'withheld'
      ? situation === 'strict'
        ? FIELD_TEXT.strictWithheld
        : FIELD_TEXT.laxWithheld
      : FIELD_TEXT.cookieSent
  return request({
    id: 'attack',
    to: BANK,
    label: 'POST /transfer (from evil.example)',
    method: 'POST',
    path: '/transfer',
    initiator: 'evil.example page (form.submit())',
    from: EVIL_ORIGIN,
    cookie,
    cookieNote: note,
    userActivation: false,
    body: TRANSFER_BODY,
    extra:
      situation === 'token'
        ? [{ name: 'csrf', value: '(missing)', highlight: true, description: FIELD_TEXT.csrf }]
        : [],
    status,
  })
}

function attackSteps(situation: Situation): Step[] {
  if (situation === 'laxGet') {
    const cookie = crossSiteDecision(situation, 'GET')
    return inSection(SECTIONS.evil, [
      {
        id: 'attack',
        title: { en: 'A GET that moves money', ja: 'お金を動かす GET' },
        description: {
          en: 'The cookie is SameSite=Lax, and this is a top-level navigation with GET, a safe method. So the browser attaches the cookie (draft-22 §5.8.3). There is no Origin header on a GET navigation, so an Origin check would not see anything either.',
          ja: 'Cookie は SameSite=Lax で、これは安全なメソッドの GET によるトップレベルのナビゲーション。そのためブラウザーは Cookie を付ける（草案 -22 §5.8.3）。GET のナビゲーションには Origin ヘッダーがないので、Origin を確かめても何も見えない。',
        },
        events: [
          send(
            request({
              id: 'attack',
              to: BANK,
              label: `GET /transfer?${TRANSFER_BODY}`,
              method: 'GET',
              path: `/transfer?${TRANSFER_BODY}`,
              initiator: 'evil.example page (location = …)',
              from: EVIL_ORIGIN,
              cookie,
              cookieNote: FIELD_TEXT.cookieSent,
              userActivation: false,
            }),
          ),
          set(BROWSER, LAST_COOKIE, cookie === 'sent' ? 'sid sent' : 'sid withheld (Lax)'),
        ],
      },
      {
        id: 'result',
        title: { en: 'Transferred anyway', ja: 'それでも送金される' },
        description: {
          en: 'bank sees a valid session and transfers the money. The bug is bank’s: a GET must not change data. RFC 9110 §9.2.1 says a resource whose action is unsafe must not be reachable with a safe method. SameSite=Lax only helps if every change needs POST (or another unsafe method). Sec-Fetch-Site: cross-site would have shown the problem.',
          ja: 'bank は正しいセッションを見て送金する。問題は bank の側にある。GET でデータを変えてはならない。RFC 9110 §9.2.1 は、安全でない動作を安全なメソッドで行えるようにしてはならないとする。SameSite=Lax が役に立つのは、変更がすべて POST（などの安全でないメソッド）を要するときだけ。Sec-Fetch-Site: cross-site を見れば、問題に気づけた。',
        },
        events: [
          send(response('result', BANK, '200 OK (transfer done)', TRANSFER_DONE)),
          set(BANK, BALANCE, '0 USD'),
          set(BANK, TRANSFER, 'transferred (to mallory)'),
          set(BROWSER, PAGE, `${BANK_URL}/transfer`),
        ],
      },
    ])
  }

  const cookie = crossSiteDecision(situation, 'POST')
  const policy = isolationPolicy({
    site: secFetchSite(EVIL_ORIGIN, [BANK_ORIGIN]),
    mode: 'navigate',
    method: 'POST',
    origin: originHeader({
      method: 'POST',
      mode: 'navigate',
      initiator: EVIL_ORIGIN,
      target: BANK_ORIGIN,
    }),
    allowedOrigin: BANK_URL,
  })
  const blocked =
    cookie === 'withheld' ||
    situation === 'token' ||
    (situation === 'fetchMetadata' && policy === 'deny')
  const lastCookie =
    cookie === 'sent'
      ? 'sid sent'
      : situation === 'strict'
        ? 'sid withheld (Strict)'
        : 'sid withheld (Lax)'
  const sendText: Record<Exclude<Situation, 'laxGet'>, LocalizedText> = {
    none: {
      en: 'The form is submitted as soon as the page loads. The cookie is SameSite=None, so the browser attaches it even though evil.example started the request. The Origin and Sec-Fetch-Site headers do say where the request came from, but bank does not look at them.',
      ja: 'ページを読み込むとすぐにフォームが送信される。Cookie は SameSite=None なので、要求を始めたのが evil.example でも、ブラウザーは Cookie を付ける。Origin と Sec-Fetch-Site のヘッダーは要求の出どころを示しているが、bank はそれを見ていない。',
    },
    lax: {
      en: 'This time the cookie is SameSite=Lax. The request is cross-site and uses POST, which is not a safe method, so the browser sends it without the cookie (draft-22 §5.8.3).',
      ja: '今回の Cookie は SameSite=Lax。要求はサイトをまたぎ、安全なメソッドではない POST を使うので、ブラウザーは Cookie を付けずに送る（草案 -22 §5.8.3）。',
    },
    strict: {
      en: 'The cookie is SameSite=Strict, so the browser sends no cookie with any request that another site started (draft-22 §5.8.3).',
      ja: 'Cookie は SameSite=Strict なので、別のサイトが始めた要求には、ブラウザーはどれにも Cookie を付けない（草案 -22 §5.8.3）。',
    },
    token: {
      en: 'The cookie is SameSite=None, so it is attached. But the form cannot include the CSRF token: the token is only on bank’s own pages, and evil.example cannot read those, because a page cannot read another origin’s response without CORS. Sending was never the problem; reading is what is blocked.',
      ja: 'Cookie は SameSite=None なので付く。しかしフォームに CSRF トークンを入れられない。トークンは bank 自身のページにしかなく、evil.example はそれを読めないから。CORS がなければ、ページは別のオリジンの応答を読めない。送ることは止められないが、読むことは止められている。',
    },
    fetchMetadata: {
      en: 'The cookie is SameSite=None, so it is attached. But the browser also says where the request came from: Sec-Fetch-Site: cross-site and Origin: https://evil.example. A page cannot change these headers.',
      ja: 'Cookie は SameSite=None なので付く。しかしブラウザーは、要求の出どころも伝える。Sec-Fetch-Site: cross-site と Origin: https://evil.example。ページはこれらのヘッダーを変えられない。',
    },
  }
  const resultText: Record<Exclude<Situation, 'laxGet'>, LocalizedText> = {
    none: {
      en: 'bank sees a valid session cookie and transfers the money. The cookie only tells bank which browser sent the request, not whether Alice meant it: this is ambient authority (draft-22 §8.2). The attacker never saw the cookie or the response, and did not need to.',
      ja: 'bank は正しいセッション Cookie を見て送金する。Cookie からわかるのはどのブラウザーからの要求かだけで、アリスが意図したかどうかではない。これが ambient authority（自動で付く権限、草案 -22 §8.2）。攻撃者は Cookie も応答も見ていないし、見る必要もない。',
    },
    lax: {
      en: 'Without the cookie, bank sees no session and refuses. The cookie was explicitly SameSite=Lax, so Chrome’s temporary two-minute exception for cookies without a SameSite attribute (Lax+POST) does not apply.',
      ja: 'Cookie がないので、bank にはセッションが見えず、断る。Cookie は明示的に SameSite=Lax なので、SameSite 属性のない Cookie に Chrome が一時的に設けている 2 分間の例外（Lax+POST）はかからない。',
    },
    strict: {
      en: 'Without the cookie, bank sees no session and refuses.',
      ja: 'Cookie がないので、bank にはセッションが見えず、断る。',
    },
    token: {
      en: 'The session is valid, but the token is missing, so bank refuses. The token must be random, tied to the session, and checked on every request that changes something (OWASP CSRF Prevention Cheat Sheet).',
      ja: 'セッションは正しいが、トークンがないので bank は断る。トークンは乱数で、セッションと結びつき、変更を伴うすべての要求で確かめる（OWASP の CSRF Prevention Cheat Sheet）。',
    },
    fetchMetadata: {
      en: 'bank’s policy refuses unsafe requests that another site started. This page’s example policy: allow same-origin and none; allow cross-site only for GET navigations such as links; if Sec-Fetch-Site is missing (older browsers, or plain http), allow unsafe methods only when Origin is https://bank.example. The standard does not prescribe a policy.',
      ja: 'bank の方針は、別のサイトが始めた安全でない要求を断る。このページの例の方針は、same-origin と none は通し、cross-site はリンクのような GET のナビゲーションだけ通す。Sec-Fetch-Site がなければ（古いブラウザーや平文の http）、安全でないメソッドは Origin が https://bank.example のときだけ通す。標準は方針を決めていない。',
    },
  }
  const refusal =
    cookie === 'withheld'
      ? '403 (no session)'
      : situation === 'token'
        ? '403 (csrf missing)'
        : '403 (cross-site)'
  const steps: Step[] = inSection(SECTIONS.evil, [
    {
      id: 'attack',
      title: blocked
        ? { en: 'The forged request is sent', ja: '偽の要求が送られる' }
        : { en: 'The browser sends the forged request', ja: 'ブラウザーが偽の要求を送る' },
      description: sendText[situation],
      events: [
        send(attackPost(situation, cookie, blocked ? 'rejected' : 'delivered')),
        set(BROWSER, LAST_COOKIE, lastCookie),
      ],
    },
    {
      id: 'result',
      title: blocked
        ? { en: 'bank refuses', ja: 'bank が断る' }
        : { en: 'The money is gone', ja: 'お金が送られてしまう' },
      description: resultText[situation],
      events: blocked
        ? [
            send(response('result', BANK, '403 Forbidden', forbidden(refusal))),
            set(BANK, TRANSFER, refusal),
            set(BROWSER, PAGE, `${BANK_URL}/transfer`),
          ]
        : [
            send(response('result', BANK, '200 OK (transfer done)', TRANSFER_DONE)),
            set(BANK, BALANCE, '0 USD'),
            set(BANK, TRANSFER, 'transferred (to mallory)'),
            set(BROWSER, PAGE, `${BANK_URL}/transfer`),
          ],
    },
  ])

  if (situation === 'lax' || situation === 'strict') {
    const linkCookie = crossSiteDecision(situation, 'GET')
    steps.push(
      ...inSection(SECTIONS.back, [
        {
          id: 'link',
          title:
            situation === 'lax'
              ? { en: 'A link to bank still works', ja: 'bank へのリンクは使える' }
              : {
                  en: 'A link to bank arrives logged out',
                  ja: 'bank へのリンクではログアウトした状態になる',
                },
          description:
            situation === 'lax'
              ? {
                  en: 'Compare: Alice goes back to evil.example and clicks an ordinary link to her bank account. That is a top-level navigation with GET, so Lax sends the cookie and she stays logged in. Lax blocks cross-site POSTs, not links.',
                  ja: '比べてみる。アリスは evil.example に戻り、自分の銀行の口座への普通のリンクを押す。これは GET によるトップレベルのナビゲーションなので、Lax は Cookie を付け、アリスはログインしたまま。Lax が止めるのはサイトをまたぐ POST で、リンクではない。',
                }
              : {
                  en: 'Compare: Alice goes back to evil.example and clicks an ordinary link to her bank account. Strict withholds the cookie even here, so bank shows the login page. This is the usability cost of Strict (draft-22 §8.8.2); some sites use two cookies, a Lax one for reading and a Strict one for changes.',
                  ja: '比べてみる。アリスは evil.example に戻り、自分の銀行の口座への普通のリンクを押す。Strict はここでも Cookie を付けないので、bank はログインのページを出す。これが Strict の使い勝手の代償（草案 -22 §8.8.2）。読むための Lax の Cookie と、変更のための Strict の Cookie の 2 つを使うサイトもある。',
                },
          events: [
            send(
              request({
                id: 'link',
                to: BANK,
                label: 'GET /account (link on evil.example)',
                method: 'GET',
                path: '/account',
                initiator: 'link on evil.example (click)',
                from: EVIL_ORIGIN,
                cookie: linkCookie,
                cookieNote:
                  linkCookie === 'sent' ? FIELD_TEXT.cookieSent : FIELD_TEXT.strictWithheld,
                userActivation: true,
              }),
            ),
            send(
              response(
                'link-page',
                BANK,
                linkCookie === 'sent' ? '200 OK (account page)' : '200 OK (login page)',
                [{ name: 'Status line', value: 'HTTP/1.1 200 OK' }],
              ),
            ),
            set(BROWSER, PAGE, `${BANK_URL}/account`),
            set(BROWSER, LAST_COOKIE, linkCookie === 'sent' ? 'sid sent' : 'sid withheld (Strict)'),
          ],
        },
      ]),
    )
  }
  return steps
}

function buildSteps({ situation }: CsrfOptions): readonly Step[] {
  return [...openingSteps(situation), ...attackSteps(situation)]
}

export const csrfScenario: Scenario<CsrfOptions> = {
  id: 'csrf',
  title: {
    en: 'Cookies and CSRF: SameSite, tokens and Fetch Metadata',
    ja: 'Cookie と CSRF: SameSite、トークン、Fetch Metadata',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'none',
          label: { en: 'SameSite=None (the attack works)', ja: 'SameSite=None（攻撃が通る）' },
        },
        { value: 'lax', label: { en: 'SameSite=Lax', ja: 'SameSite=Lax' } },
        { value: 'strict', label: { en: 'SameSite=Strict', ja: 'SameSite=Strict' } },
        {
          value: 'laxGet',
          label: { en: 'Lax, but a GET moves money', ja: 'Lax でも GET で送金できる' },
        },
        { value: 'token', label: { en: 'CSRF token', ja: 'CSRF トークン' } },
        {
          value: 'fetchMetadata',
          label: {
            en: 'Check Sec-Fetch-Site and Origin',
            ja: 'Sec-Fetch-Site と Origin を確かめる',
          },
        },
      ],
      defaultValue: 'none',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
