/**
 * HSTS と SSL ストリッピング
 *
 * 根拠:
 * - RFC 6797 §2.3.1（受動的・能動的な攻撃者、公衆無線 LAN）、§5.3（ホストごとに保存）、§6.1（構文。順不同、重複不可、
 *   名前は大文字小文字を区別しない、不正なら無視、知らないディレクティブは無視）、§6.1.1 / §6.1.2（max-age、includeSubDomains）、
 *   §6.2（例）、§7.1（安全な接続の応答に付ける）、§7.2（平文の要求には恒久的なリダイレクト。平文の応答に付けてはならない）、
 *   §8.1（安全な接続で誤りなく受けたときだけ記録・更新。平文で受けたものは無視。最初の 1 つだけ。max-age=0 で削除）、
 *   §8.1.1（IP アドレスは記録しない、上位ドメインの記録は変えない、期限切れは消す）、§8.2（ラベルごとの照合）、
 *   §8.3（https への書き換えとポート 80 → 443）、§8.4（安全な接続の誤りでは必ず打ち切る）、§11.2、§11.4.2、
 *   §12.1（利用者に先へ進む手段を与えない。非規範）、§12.3（プリロードリスト。非規範）、§14.4、§14.6（初回の中間者攻撃）
 * - RFC 9110 §4.2.2（https）、§15.4.2（301）、§15.4.4（303）、§15.4.9（308）（RFC 7538 と RFC 2818 は RFC 9110 に置き換えられた）
 * - RFC 6265 §3.1（SID と lang の例）、§4.1.2.5（Secure）、§5.3 / §5.4（ホストだけ、secure-only）、§8.3
 * - RFC 9846 §6.2（unknown_ca）、RFC 5280 §6、RFC 5737、RFC 2606
 * - RFC ではないもの: Moxie Marlinspike「New Tricks for Defeating SSL in Practice」（Black Hat DC 2009、sslstrip）、
 *   HSTS プリロードリスト（https://hstspreload.org/ 、Chrome の運営。2026-09-29 に確認した要件）
 *
 * 学習用の単純化: スキームを付けずに入力した名前は http で開く（HTTPS-First や自動の格上げは使わない）。攻撃者は同じ Wi-Fi にいて、
 * 経路上ですべてのパケットを受け取る（手段は描かない）。NAT は描かず、説明用のアドレスをそのまま使う。攻撃者は 301 を渡さず、自分で
 * https に従う（sslstrip は https のリンクとリダイレクトを http に書き換え、自分で https で取りにいく。ここでは結果だけを示す）。
 * TLS のハンドシェイクは 3 つにまとめ、TCP のハンドシェイクと ACK は描かない。TLS の中は HTTP/1.1 で示す（実際は h2 が多い）。
 * 301 のキャッシュは描かない。時刻は UTC で、今回の訪問は 2026-10-01T09:00:00Z。プリロードの項目と、ヘッダーで知った項目を
 * 別の行として持つのはこのページの模型
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
import { cookieHeader, cookiesToSend, type StoredCookie } from './cookies'
import { matchKnownHost, noteHeader, upgradeUri, type KnownHost } from './store'

const SITUATIONS = ['noHsts', 'known', 'expired', 'badCert', 'subdomain', 'preload'] as const
type Situation = (typeof SITUATIONS)[number]

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('noHsts'),
})
export type HstsOptions = z.infer<typeof optionsSchema>

const BROWSER = 'browser'
const ATTACKER = 'attacker'
const SITE = 'site'

const URL_KEY: StateKey = 'url'
const CHECK: StateKey = 'check'
const HSTS: StateKey = 'hsts'
const COOKIES: StateKey = 'cookies'
const TLS: StateKey = 'tls'
const MODE: StateKey = 'mode'
const SEEN: StateKey = 'seen'
const CLIENT: StateKey = 'client'
const LOGIN: StateKey = 'login'
export const HSTS_COLUMNS = ['Host', 'Subdomains', 'Expires', 'Source'] as const
export const COOKIE_COLUMNS = ['Name', 'Value', 'Secure'] as const
export const SEEN_COLUMNS = ['Field', 'Value'] as const

/** 説明用のアドレス（RFC 5737）と名前（RFC 2606） */
export const ADDR = {
  browser: '198.51.100.20',
  browserPort: 51514,
  attacker: '198.51.100.66',
  site: '192.0.2.10',
} as const
export const NOW = '2026-10-01T09:00:00Z'
export const STS_VALUE = 'max-age=31536000; includeSubDomains'
export const STS_PRELOAD = 'max-age=31536000; includeSubDomains; preload'
export const PASSWORD_BODY = 'user=alice&password=example-pass'
const NEW_SID = '5b2f0e3c9a71d4e8'

/** RFC 6265 §3.1 の例の Cookie（SID は Secure でホストだけ、lang は Domain=example.com） */
export const JAR: readonly StoredCookie[] = [
  { name: 'SID', value: '31d4d96e407aad42', domain: 'example.com', hostOnly: true, secure: true },
  { name: 'lang', value: 'en-US', domain: 'example.com', hostOnly: false, secure: false },
]

/** 状況ごとに、ブラウザーが最初から持っている HSTS の記録 */
const INITIAL_STORE: Record<Situation, readonly KnownHost[]> = {
  noHsts: [],
  known: [
    {
      host: 'example.com',
      includeSubDomains: true,
      expires: '2027-06-01T09:00:00Z',
      source: 'header',
    },
  ],
  expired: [
    {
      host: 'example.com',
      includeSubDomains: true,
      expires: '2026-09-01T09:00:00Z',
      source: 'header',
    },
  ],
  badCert: [
    {
      host: 'example.com',
      includeSubDomains: true,
      expires: '2027-06-01T09:00:00Z',
      source: 'header',
    },
  ],
  subdomain: [
    {
      host: 'example.com',
      includeSubDomains: true,
      expires: '2027-06-01T09:00:00Z',
      source: 'header',
    },
  ],
  preload: [{ host: 'example.com', includeSubDomains: true, expires: null, source: 'preload' }],
}

const hstsTable = (store: readonly KnownHost[]): StateTable => ({
  columns: HSTS_COLUMNS,
  rows: store.map((entry) => [
    entry.host,
    entry.includeSubDomains ? 'yes' : 'no',
    entry.expires ?? '(built in)',
    entry.source === 'preload' ? 'preload list' : 'header',
  ]),
})

const cookieTable = (jar: readonly StoredCookie[]): StateTable => ({
  columns: COOKIE_COLUMNS,
  rows: jar.map((cookie) => [cookie.name, cookie.value, cookie.secure ? 'yes' : 'no']),
})

const seenTable = (rows: readonly (readonly [string, string])[]): StateTable => ({
  columns: SEEN_COLUMNS,
  rows,
})

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: `Browser (${ADDR.browser})`, ja: `ブラウザー（${ADDR.browser}）` },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: URL_KEY, label: { en: 'Address bar', ja: 'アドレスバー' }, initial: '-' },
      { key: CHECK, label: { en: 'HSTS check', ja: 'HSTS の照合' }, initial: '-' },
      {
        key: HSTS,
        label: { en: 'Known HSTS hosts', ja: '既知の HSTS ホスト' },
        initial: { columns: HSTS_COLUMNS, rows: [] },
      },
      {
        key: COOKIES,
        label: { en: 'Cookies', ja: 'Cookie' },
        initial: { columns: COOKIE_COLUMNS, rows: [] },
      },
      { key: TLS, label: { en: 'Connection', ja: '接続' }, initial: '-' },
    ],
  },
  {
    id: ATTACKER,
    // 経路の途中でパケットを中継する機器として、ルーターの色で描く
    kind: 'router',
    name: {
      en: `Attacker (${ADDR.attacker}, same Wi-Fi)`,
      ja: `攻撃者（${ADDR.attacker}、同じ Wi-Fi）`,
    },
    shortName: { en: 'Attacker', ja: '攻撃者' },
    stateSlots: [
      { key: MODE, label: { en: 'What it does', ja: 'していること' }, initial: 'waiting for http' },
      {
        key: SEEN,
        label: { en: 'What it can read', ja: '読めるもの' },
        initial: { columns: SEEN_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: SITE,
    kind: 'server',
    name: {
      en: `Site: example.com, www (${ADDR.site})`,
      ja: `サイト: example.com、www（${ADDR.site}）`,
    },
    shortName: { en: 'Site', ja: 'サイト' },
    stateSlots: [
      { key: CLIENT, label: { en: 'Client it sees', ja: '見えるクライアント' }, initial: '-' },
      { key: LOGIN, label: { en: 'Session', ja: 'セッション' }, initial: '-' },
    ],
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
  sts: {
    en: 'Strict-Transport-Security (RFC 6797): for max-age seconds, the browser must use only https for this host (and its subdomains with includeSubDomains)',
    ja: 'Strict-Transport-Security（RFC 6797）: max-age 秒のあいだ、ブラウザーはこのホストに（includeSubDomains ならサブドメインにも）https だけを使う',
  },
  stsRemoved: {
    en: 'The attacker removed the header. Even if it had left it in, the browser must ignore it over http (§8.1), and the site must not send it over http (§7.2)',
    ja: '攻撃者がヘッダーを外した。残したとしても、ブラウザーは http で受けたものを無視しなければならず（§8.1）、サイトは http で送ってはならない（§7.2）',
  },
  cookieHttp: {
    en: 'SID is not sent over http because it is Secure (RFC 6265 §5.4). lang has no Secure, so it leaks here, before any redirect',
    ja: 'SID は Secure なので http では送られない（RFC 6265 §5.4）。lang には Secure がないので、リダイレクトの前にここで漏れる',
  },
  location: {
    en: 'The site redirects http to https correctly (RFC 6797 §7.2), but the redirect only reaches the attacker',
    ja: 'サイトは http を https へ正しくリダイレクトする（RFC 6797 §7.2）が、リダイレクトは攻撃者にしか届かない',
  },
  rewritten: {
    en: 'The attacker changed every https link to http, so the browser stays on http',
    ja: '攻撃者が https のリンクをすべて http に書き換えたので、ブラウザーは http のまま',
  },
  secureRemoved: {
    en: 'The attacker removed Secure; otherwise the browser would never send this cookie over http',
    ja: '攻撃者が Secure を外した。そうしないと、ブラウザーはこの Cookie を http で送らないから',
  },
  ciphertext: {
    en: 'The attacker relays these TLS records but cannot read or change them',
    ja: '攻撃者はこの TLS のレコードを中継するが、読むことも変えることもできない',
  },
  fakeCert: {
    en: 'The attacker has no certificate for example.com from a trusted CA, so it presents its own',
    ja: '攻撃者は信頼された CA の example.com の証明書を持っていないので、自分の証明書を出す',
  },
} satisfies Record<string, LocalizedText>

interface Hop {
  readonly id: MessageId
  readonly from: string
  readonly to: string
  readonly label: string
  readonly fields: readonly PacketField[]
  readonly encrypted?: boolean
  readonly status?: MessageStatus
}

const hop = (spec: Hop): Message => ({
  id: spec.id,
  from: spec.from,
  to: spec.to,
  label: spec.label,
  status: spec.status ?? 'delivered',
  fields: [...spec.fields],
  ...(spec.encrypted === true ? { encrypted: true } : {}),
})

const SECTIONS = {
  typed: { en: 'Alice types example.com', ja: 'アリスが example.com と入力する' },
  http: { en: 'Over plain http', ja: '平文の http で' },
  https: { en: 'Straight to https', ja: '最初から https で' },
} satisfies Record<string, LocalizedText>

type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

function checkValue(situation: Situation, host: string): string {
  const store = INITIAL_STORE[situation]
  if (situation === 'expired') {
    return 'expired (evicted)'
  }
  const match = matchKnownHost(store, host, NOW)
  if (match.kind === 'none') {
    return 'no match'
  }
  if (match.kind === 'superdomain') {
    return `superdomain: ${match.entry.host} (includeSubDomains)`
  }
  return match.entry.source === 'preload'
    ? `congruent: ${match.entry.host} (preload list)`
    : `congruent: ${match.entry.host}`
}

function typedStep(situation: Situation, host: string): Step {
  const store = INITIAL_STORE[situation]
  const jar = situation === 'preload' ? [] : JAR
  const evicted = situation === 'expired' ? [] : store
  const descriptions: Record<Situation, LocalizedText> = {
    noHsts: {
      en: 'Alice is in a café and joins its Wi-Fi. She types example.com without a scheme, so the browser starts with http. It has no HSTS record for example.com. An attacker is on the same Wi-Fi and on the path of every packet.',
      ja: 'アリスはカフェにいて、その Wi-Fi につないでいる。スキームを付けずに example.com と入力したので、ブラウザーは http で始める。example.com の HSTS の記録はない。同じ Wi-Fi に攻撃者がいて、すべてのパケットの経路の途中にいる。',
    },
    known: {
      en: 'Alice visited example.com over https before, and the site sent Strict-Transport-Security. So example.com is a Known HSTS Host in her browser. She types example.com, and the browser checks its records before sending anything.',
      ja: 'アリスは以前 https で example.com を訪れ、サイトは Strict-Transport-Security を送った。そのため、example.com はブラウザーの既知の HSTS ホストになっている。アリスが example.com と入力すると、ブラウザーは何かを送る前に記録を調べる。',
    },
    expired: {
      en: 'Alice last visited a year ago, and the record’s max-age has run out. An expired Known HSTS Host must be evicted (§8.1.1), so the browser knows nothing about example.com: exactly like a first visit (§14.6). It starts with http.',
      ja: 'アリスが最後に訪れたのは 1 年前で、記録の max-age は切れている。期限切れの既知の HSTS ホストは消さなければならない（§8.1.1）ので、ブラウザーは example.com について何も知らない。初めての訪問とまったく同じ（§14.6）。http で始める。',
    },
    badCert: {
      en: 'As before, example.com is a Known HSTS Host. This time the attacker tries a different trick: it answers the TLS connection itself.',
      ja: '前と同じく、example.com は既知の HSTS ホスト。今回、攻撃者は別の手を使う。TLS の接続に自分で答える。',
    },
    subdomain: {
      en: 'example.com’s record has includeSubDomains. Alice types www.example.com, a host the browser has no record of. The browser checks whether a parent domain covers it.',
      ja: 'example.com の記録には includeSubDomains がある。アリスは www.example.com と入力する。ブラウザーには記録のないホスト。ブラウザーは、上位のドメインがこれを含むかを調べる。',
    },
    preload: {
      en: 'Alice has never visited example.com, and has no cookies for it. But example.com is on the HSTS preload list built into the browser, so it is a Known HSTS Host from the start.',
      ja: 'アリスは example.com を訪れたことがなく、Cookie もない。しかし example.com はブラウザーに組み込まれた HSTS のプリロードリストに載っているので、最初から既知の HSTS ホスト。',
    },
  }
  return {
    id: 'typed',
    section: SECTIONS.typed,
    title: { en: `Alice types ${host}`, ja: `アリスが ${host} と入力する` },
    description: descriptions[situation],
    events: [
      set(BROWSER, URL_KEY, `http://${host}/`),
      set(BROWSER, HSTS, hstsTable(evicted)),
      set(BROWSER, COOKIES, cookieTable(jar)),
      set(BROWSER, CHECK, checkValue(situation, host)),
    ],
  }
}

// ---------- HSTS が効かない（記録がない、期限切れ） ----------

function strippedSteps(situation: 'noHsts' | 'expired'): Step[] {
  const expired = situation === 'expired'
  const stsFields = (removed: boolean): PacketField[] =>
    expired
      ? [
          {
            name: 'Strict-Transport-Security',
            value: removed ? '(removed)' : STS_VALUE,
            highlight: true,
            description: removed ? FIELD_TEXT.stsRemoved : FIELD_TEXT.sts,
          },
        ]
      : []
  const httpCookie =
    cookieHeader(cookiesToSend(JAR, { host: 'example.com', secure: false })) ?? '(none)'
  return [
    typedStep(situation, 'example.com'),
    ...inSection(SECTIONS.http, [
      {
        id: 'http-request',
        title: { en: 'The first request goes out over http', ja: '最初の要求が http で出ていく' },
        description: {
          en: 'The request to port 80 is plaintext. The attacker, on the path, receives it and can read everything, including the cookie that has no Secure attribute.',
          ja: 'ポート 80 への要求は平文。経路の途中の攻撃者がそれを受け取り、Secure 属性のない Cookie も含めて、すべてを読める。',
        },
        events: [
          send(
            hop({
              id: 'http-request',
              from: BROWSER,
              to: ATTACKER,
              label: 'GET / HTTP/1.1 (port 80)',
              fields: [
                {
                  name: 'TCP',
                  value: `${ADDR.browser}:${String(ADDR.browserPort)} → ${ADDR.site}:80`,
                },
                { name: 'Request line', value: 'GET / HTTP/1.1' },
                { name: 'Host', value: 'example.com' },
                {
                  name: 'Cookie',
                  value: httpCookie,
                  highlight: true,
                  description: FIELD_TEXT.cookieHttp,
                },
              ],
            }),
          ),
          set(BROWSER, TLS, 'none (http)'),
          set(ATTACKER, MODE, 'stripping'),
          set(ATTACKER, SEEN, seenTable([['Cookie', httpCookie]])),
        ],
      },
      {
        id: 'forward',
        title: {
          en: 'The site redirects to https, but to the attacker',
          ja: 'サイトは https にリダイレクトするが、相手は攻撃者',
        },
        description: {
          en: 'The attacker forwards the request, and the site answers correctly: 301 to https (RFC 9110 §15.4.2). But the attacker keeps the redirect instead of passing it on.',
          ja: '攻撃者は要求を転送し、サイトは正しく答える。https への 301（RFC 9110 §15.4.2）。しかし攻撃者はリダイレクトを渡さずに持っておく。',
        },
        events: [
          send(
            hop({
              id: 'forward',
              from: ATTACKER,
              to: SITE,
              label: 'GET / HTTP/1.1',
              fields: [
                { name: 'Request line', value: 'GET / HTTP/1.1' },
                { name: 'Host', value: 'example.com' },
              ],
            }),
          ),
          send(
            hop({
              id: 'redirect',
              from: SITE,
              to: ATTACKER,
              label: '301 Moved Permanently',
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 301 Moved Permanently' },
                {
                  name: 'Location',
                  value: 'https://example.com/',
                  highlight: true,
                  description: FIELD_TEXT.location,
                },
              ],
            }),
          ),
          set(SITE, CLIENT, `http from ${ADDR.attacker}`),
        ],
      },
      {
        id: 'attacker-tls',
        title: { en: 'The attacker follows https itself', ja: '攻撃者が自分で https に従う' },
        description: {
          en: 'The attacker opens its own TLS connection to example.com. The site sees an ordinary https client, with the attacker’s address.',
          ja: '攻撃者は自分で example.com への TLS の接続を開く。サイトから見ると、攻撃者のアドレスの、普通の https のクライアント。',
        },
        events: [
          send(
            hop({
              id: 'attacker-hello',
              from: ATTACKER,
              to: SITE,
              label: 'ClientHello (SNI example.com)',
              fields: [{ name: 'server_name', value: 'example.com' }],
            }),
          ),
          send(
            hop({
              id: 'attacker-server-hello',
              from: SITE,
              to: ATTACKER,
              label: 'ServerHello … Finished',
              fields: [{ name: 'Certificate', value: 'example.com (trusted CA)' }],
            }),
          ),
          send(
            hop({
              id: 'attacker-finished',
              from: ATTACKER,
              to: SITE,
              label: 'Finished',
              encrypted: true,
              fields: [{ name: 'Handshake', value: 'Finished' }],
            }),
          ),
          set(SITE, CLIENT, `https from ${ADDR.attacker}`),
        ],
      },
      {
        id: 'fetch',
        title: { en: 'The attacker fetches the page', ja: '攻撃者がページを取ってくる' },
        description: expired
          ? {
              en: 'The page comes back over TLS, and this time the response carries Strict-Transport-Security. But it is addressed to the attacker’s TLS connection, not to Alice’s browser.',
              ja: 'ページは TLS で返ってくる。今回の応答には Strict-Transport-Security も付いている。しかしそれは攻撃者の TLS の接続への応答で、アリスのブラウザーへのものではない。',
            }
          : {
              en: 'The page comes back over TLS. Its links point to https://example.com/login.',
              ja: 'ページは TLS で返ってくる。リンクは https://example.com/login を指している。',
            },
        events: [
          send(
            hop({
              id: 'attacker-get',
              from: ATTACKER,
              to: SITE,
              label: 'GET / (inside TLS)',
              encrypted: true,
              fields: [{ name: 'Request line', value: 'GET / HTTP/1.1' }],
            }),
          ),
          send(
            hop({
              id: 'page',
              from: SITE,
              to: ATTACKER,
              label: expired ? '200 OK (HSTS header)' : '200 OK',
              encrypted: true,
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                ...stsFields(false),
                { name: 'Body', value: '<a href="https://example.com/login">Log in</a>' },
              ],
            }),
          ),
        ],
      },
      {
        id: 'rewritten',
        title: { en: 'Alice gets the page over http', ja: 'アリスには http でページが届く' },
        description: {
          en: 'The attacker sends the page to Alice over the http connection she opened, with every https link rewritten to http. This is SSL stripping (Marlinspike’s sslstrip, 2009). Alice sees the right page; only the address bar shows that it is not secure.',
          ja: '攻撃者は、アリスが開いた http の接続でページを返す。https のリンクはすべて http に書き換えてある。これが SSL ストリッピング（Marlinspike の sslstrip、2009 年）。アリスには正しいページが見え、安全でないことはアドレスバーにしか表れない。',
        },
        events: [
          send(
            hop({
              id: 'rewritten',
              from: ATTACKER,
              to: BROWSER,
              label: '200 OK (https links → http)',
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                ...stsFields(true),
                {
                  name: 'Body',
                  value: '<a href="http://example.com/login">Log in</a>',
                  highlight: true,
                  description: FIELD_TEXT.rewritten,
                },
              ],
            }),
          ),
          set(BROWSER, URL_KEY, 'http://example.com/ (not secure)'),
        ],
      },
      {
        id: 'login',
        title: { en: 'Alice logs in over http', ja: 'アリスが http でログインする' },
        description: {
          en: 'The browser never sent SID over http, so the site asks Alice to log in again. The form goes to the rewritten http link, and the attacker reads her password.',
          ja: 'ブラウザーは SID を http で送らなかったので、サイトはアリスにもう一度ログインを求める。フォームは書き換えられた http のリンクに送られ、攻撃者はパスワードを読む。',
        },
        events: [
          send(
            hop({
              id: 'login',
              from: BROWSER,
              to: ATTACKER,
              label: 'POST /login (http)',
              fields: [
                { name: 'Request line', value: 'POST /login HTTP/1.1' },
                { name: 'Cookie', value: httpCookie },
                { name: 'Body', value: PASSWORD_BODY, highlight: true },
              ],
            }),
          ),
          set(
            ATTACKER,
            SEEN,
            seenTable([
              ['Cookie', httpCookie],
              ['Body', PASSWORD_BODY],
            ]),
          ),
        ],
      },
      {
        id: 'relay-login',
        title: { en: 'The attacker logs in for her', ja: '攻撃者がアリスに代わってログインする' },
        description: {
          en: 'The attacker sends the same form to the site over TLS. The site sees a valid https login and creates a session, for the attacker’s connection.',
          ja: '攻撃者は同じフォームを TLS でサイトに送る。サイトには正しい https のログインに見え、セッションを作る。攻撃者の接続に対して。',
        },
        events: [
          send(
            hop({
              id: 'relay-login',
              from: ATTACKER,
              to: SITE,
              label: 'POST /login (inside TLS)',
              encrypted: true,
              fields: [
                { name: 'Request line', value: 'POST /login HTTP/1.1' },
                { name: 'Body', value: PASSWORD_BODY },
              ],
            }),
          ),
          send(
            hop({
              id: 'session',
              from: SITE,
              to: ATTACKER,
              label: '303 See Other',
              encrypted: true,
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 303 See Other' },
                { name: 'Set-Cookie', value: `SID=${NEW_SID}; Path=/; Secure; HttpOnly` },
                ...stsFields(false),
              ],
            }),
          ),
          set(SITE, LOGIN, `alice (from ${ADDR.attacker})`),
          set(
            ATTACKER,
            SEEN,
            seenTable([
              ['Cookie', httpCookie],
              ['Body', PASSWORD_BODY],
              ['Set-Cookie', `SID=${NEW_SID}`],
            ]),
          ),
        ],
      },
      {
        id: 'relay-303',
        title: { en: 'Secure is removed, too', ja: 'Secure も外される' },
        description: {
          en: 'The attacker passes the redirect to Alice over http, after removing Secure from the cookie. From now on the new session cookie also travels over http, where the attacker can read it.',
          ja: '攻撃者はリダイレクトを http でアリスに渡す。Cookie から Secure を外してある。以後、新しいセッションの Cookie も http で流れ、攻撃者に読まれる。',
        },
        events: [
          send(
            hop({
              id: 'relay-303',
              from: ATTACKER,
              to: BROWSER,
              label: '303 See Other (Secure removed)',
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 303 See Other' },
                {
                  name: 'Set-Cookie',
                  value: `SID=${NEW_SID}; Path=/; HttpOnly`,
                  highlight: true,
                  description: FIELD_TEXT.secureRemoved,
                },
                ...stsFields(true),
              ],
            }),
          ),
          set(
            BROWSER,
            COOKIES,
            // 攻撃者が Secure を外したので、新しい SID は secure-only ではない Cookie として保存される
            cookieTable([
              { name: 'SID', value: NEW_SID, domain: 'example.com', hostOnly: true, secure: false },
              ...JAR.filter((cookie) => cookie.name !== 'SID'),
            ]),
          ),
          set(ATTACKER, MODE, 'holding alice’s session'),
        ],
      },
      {
        id: 'summary',
        title: {
          en: 'Everything looked normal to the site',
          ja: 'サイトからは何もおかしく見えない',
        },
        description: expired
          ? {
              en: 'The site did everything right: a redirect to https and an HSTS header. But the header only reaches a browser over a secure connection, and this browser never got one. An expired record leaves the browser exactly where it is on a first visit (§14.6). The preload list is the answer to that.',
              ja: 'サイトはすべて正しく行った。https へのリダイレクトと HSTS のヘッダー。しかしヘッダーが意味を持つのは安全な接続でブラウザーに届いたときだけで、このブラウザーには一度も届いていない。期限切れの記録は、初めての訪問とまったく同じ状態をつくる（§14.6）。その答えがプリロードリスト。',
            }
          : {
              en: 'The site saw a perfectly valid https login, only from the attacker’s address. The redirect to https cannot protect the first request, because the first request is exactly what the attacker takes over.',
              ja: 'サイトに見えたのは完全に正しい https のログインで、ただ攻撃者のアドレスから来ていた。https へのリダイレクトでは最初の要求を守れない。攻撃者が乗っ取るのは、まさにその最初の要求だから。',
            },
        events: [set(SITE, CLIENT, `https from ${ADDR.attacker} (alice’s session)`)],
      },
    ]),
  ]
}

// ---------- HSTS が効く ----------

function tlsHops(host: string): StepEvent[] {
  return [
    send(
      hop({
        id: 'client-hello',
        from: BROWSER,
        to: ATTACKER,
        label: `ClientHello (SNI ${host})`,
        fields: [{ name: 'server_name', value: host }],
      }),
    ),
    send(
      hop({
        id: 'client-hello-relay',
        from: ATTACKER,
        to: SITE,
        label: `ClientHello (SNI ${host})`,
        fields: [{ name: 'server_name', value: host }],
      }),
    ),
    send(
      hop({
        id: 'server-hello',
        from: SITE,
        to: ATTACKER,
        label: 'ServerHello … Finished',
        fields: [{ name: 'Certificate', value: 'example.com, www.example.com (trusted CA)' }],
      }),
    ),
    send(
      hop({
        id: 'server-hello-relay',
        from: ATTACKER,
        to: BROWSER,
        label: 'ServerHello … Finished',
        fields: [{ name: 'Certificate', value: 'example.com, www.example.com (trusted CA)' }],
      }),
    ),
    set(ATTACKER, MODE, 'relaying TLS (ciphertext only)'),
  ]
}

function protectedSteps(situation: 'known' | 'subdomain' | 'preload'): Step[] {
  const host = situation === 'subdomain' ? 'www.example.com' : 'example.com'
  const jar = situation === 'preload' ? [] : JAR
  const store = INITIAL_STORE[situation]
  const cookie = cookieHeader(cookiesToSend(jar, { host, secure: true })) ?? '(none)'
  const stsSent =
    situation === 'subdomain'
      ? 'max-age=31536000'
      : situation === 'preload'
        ? STS_PRELOAD
        : STS_VALUE
  const updated = noteHeader(store, {
    host,
    headers: [stsSent],
    secure: true,
    transportOk: true,
    now: NOW,
  })
  const upgraded = upgradeUri(`http://${host}/`)
  const responseText: Record<typeof situation, LocalizedText> = {
    known: {
      en: 'The response carries Strict-Transport-Security again, received over a secure connection, so the browser updates the record: the expiry moves to one year from now (§8.1, §11.2). A site that sends the header on every response keeps the record from expiring.',
      ja: '応答にはまた Strict-Transport-Security が付き、安全な接続で受けたので、ブラウザーは記録を新しくする。期限は今から 1 年後に延びる（§8.1、§11.2）。すべての応答にヘッダーを付けるサイトなら、記録は切れない。',
    },
    subdomain: {
      en: 'www.example.com sends its own header, so the browser adds a record for it. The example.com record is left unchanged: a superdomain match must not be modified (§8.1.1). Without includeSubDomains on example.com, www would not have matched, and the first request would have gone out over http, leaking the domain cookie lang (§14.4).',
      ja: 'www.example.com も自分のヘッダーを送るので、ブラウザーはその記録を足す。example.com の記録は変えない。上位ドメインとして一致した記録は変えてはならない（§8.1.1）。example.com に includeSubDomains がなければ www は一致せず、最初の要求は http で出ていき、ドメインの Cookie の lang が漏れていた（§14.4）。',
    },
    preload: {
      en: 'The header also says preload. RFC 6797 does not define it, so the browser ignores it (§6.1 rule 5); it is only a signal for the preload list’s submission form. The browser notes the header next to the built-in entry. The list protects the first visit (§12.3). It is a browser programme, not an RFC, and removal takes months; its operators now write that while HSTS is recommended, preloading is not, because browsers increasingly upgrade to https on their own (checked 2026-09-29).',
      ja: 'ヘッダーには preload もある。RFC 6797 は preload を定めていないので、ブラウザーは無視する（§6.1 の規則 5）。preload は、プリロードリストの申し込みのための印にすぎない。ブラウザーは、組み込みの項目とは別にヘッダーの記録を持つ。リストが守るのは初めての訪問（§12.3）。リストは RFC ではなくブラウザーの取り組みで、外すのに何か月もかかる。運営者は今、HSTS は勧めるがプリロードは勧めないと書いている。ブラウザーが自分で https に上げることが増えたから（2026-09-29 に確認）。',
    },
  }
  return [
    typedStep(situation, host),
    ...inSection(SECTIONS.https, [
      {
        id: 'upgrade',
        title: {
          en: 'The browser switches to https before sending',
          ja: 'ブラウザーが送る前に https に切り替える',
        },
        description: {
          en: `A known HSTS host matched, so before loading the URL the browser must replace http with https, and an explicit port 80 with 443 (§8.3). Nothing is sent over http, so there is nothing for the attacker to strip. ${situation === 'subdomain' ? 'The match is with the parent domain example.com, whose record has includeSubDomains.' : ''}`.trim(),
          ja: `既知の HSTS ホストに一致したので、ブラウザーは URL を読み込む前に http を https に、明示されたポート 80 を 443 に置き換えなければならない（§8.3）。http では何も送らないので、攻撃者が剥ぎ取るものはない。${situation === 'subdomain' ? '一致したのは上位ドメインの example.com で、その記録に includeSubDomains がある。' : ''}`,
        },
        events: [set(BROWSER, URL_KEY, `${upgraded} (HSTS upgrade)`)],
      },
      {
        id: 'tls',
        title: { en: 'TLS passes through the attacker', ja: 'TLS は攻撃者を通り抜ける' },
        description: {
          en: 'The attacker is still on the path, but it can only relay the TLS handshake. The certificate comes from the real site and is signed by a trusted CA.',
          ja: '攻撃者はまだ経路の途中にいるが、TLS のハンドシェイクを中継することしかできない。証明書は本物のサイトのもので、信頼された CA が署名している。',
        },
        events: tlsHops(host),
      },
      {
        id: 'finished',
        title: {
          en: 'An encrypted connection to the real site',
          ja: '本物のサイトとの暗号化された接続',
        },
        description: {
          en: 'The handshake completes between the browser and the site. From here on, the attacker sees only ciphertext.',
          ja: 'ハンドシェイクはブラウザーとサイトの間で終わる。ここから先、攻撃者に見えるのは暗号文だけ。',
        },
        events: [
          send(
            hop({
              id: 'finished',
              from: BROWSER,
              to: ATTACKER,
              label: 'Finished',
              encrypted: true,
              fields: [{ name: 'Handshake', value: 'Finished' }],
            }),
          ),
          send(
            hop({
              id: 'finished-relay',
              from: ATTACKER,
              to: SITE,
              label: 'Finished',
              encrypted: true,
              fields: [{ name: 'Handshake', value: 'Finished' }],
            }),
          ),
          set(BROWSER, TLS, 'TLS 1.3, cert OK'),
        ],
      },
      {
        id: 'request',
        title: { en: 'The request travels inside TLS', ja: '要求は TLS の中を通る' },
        description:
          situation === 'subdomain'
            ? {
                en: 'Only lang is sent: SID is host-only for example.com, while lang has Domain=example.com (RFC 6265 §5.4).',
                ja: '送られるのは lang だけ。SID は example.com だけのもので、lang には Domain=example.com がある（RFC 6265 §5.4）。',
              }
            : situation === 'preload'
              ? {
                  en: 'This is Alice’s first visit, so there are no cookies yet.',
                  ja: 'アリスの初めての訪問なので、まだ Cookie はない。',
                }
              : {
                  en: 'Now SID is sent too, since this is https, and the attacker cannot read it.',
                  ja: 'https なので SID も送られ、攻撃者には読めない。',
                },
        events: [
          send(
            hop({
              id: 'request',
              from: BROWSER,
              to: ATTACKER,
              label: 'GET / (inside TLS)',
              encrypted: true,
              fields: [
                { name: 'Request line', value: 'GET / HTTP/1.1' },
                { name: 'Host', value: host },
                { name: 'Cookie', value: cookie },
                {
                  name: 'Visible to the attacker',
                  value: '(ciphertext only)',
                  description: FIELD_TEXT.ciphertext,
                },
              ],
            }),
          ),
          send(
            hop({
              id: 'request-relay',
              from: ATTACKER,
              to: SITE,
              label: 'GET / (inside TLS)',
              encrypted: true,
              fields: [
                { name: 'Request line', value: 'GET / HTTP/1.1' },
                { name: 'Host', value: host },
                { name: 'Cookie', value: cookie },
              ],
            }),
          ),
          set(ATTACKER, SEEN, seenTable([['TLS records', '(ciphertext only)']])),
          set(SITE, CLIENT, `https from ${ADDR.browser}`),
        ],
      },
      {
        id: 'response',
        title: { en: 'The HSTS record is renewed', ja: 'HSTS の記録が新しくなる' },
        description: responseText[situation],
        events: [
          send(
            hop({
              id: 'response',
              from: SITE,
              to: ATTACKER,
              label: '200 OK (HSTS header)',
              encrypted: true,
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                {
                  name: 'Strict-Transport-Security',
                  value: stsSent,
                  highlight: true,
                  description: FIELD_TEXT.sts,
                },
              ],
            }),
          ),
          send(
            hop({
              id: 'response-relay',
              from: ATTACKER,
              to: BROWSER,
              label: '200 OK (HSTS header)',
              encrypted: true,
              fields: [
                { name: 'Status line', value: 'HTTP/1.1 200 OK' },
                {
                  name: 'Strict-Transport-Security',
                  value: stsSent,
                  highlight: true,
                  description: FIELD_TEXT.sts,
                },
              ],
            }),
          ),
          set(BROWSER, HSTS, hstsTable(updated)),
          set(BROWSER, URL_KEY, upgraded),
        ],
      },
    ]),
  ]
}

function badCertSteps(): Step[] {
  return [
    typedStep('badCert', 'example.com'),
    ...inSection(SECTIONS.https, [
      {
        id: 'upgrade',
        title: {
          en: 'The browser switches to https before sending',
          ja: 'ブラウザーが送る前に https に切り替える',
        },
        description: {
          en: 'As before, the browser upgrades to https before sending anything (§8.3), so stripping is impossible.',
          ja: '前と同じく、ブラウザーは何かを送る前に https に上げる（§8.3）ので、ストリッピングはできない。',
        },
        events: [set(BROWSER, URL_KEY, `${upgradeUri('http://example.com/')} (HSTS upgrade)`)],
      },
      {
        id: 'intercept',
        title: { en: 'The attacker answers the TLS connection', ja: '攻撃者が TLS の接続に答える' },
        description: {
          en: 'The attacker does not relay the ClientHello. It pretends to be example.com.',
          ja: '攻撃者は ClientHello を中継しない。example.com のふりをする。',
        },
        events: [
          send(
            hop({
              id: 'client-hello',
              from: BROWSER,
              to: ATTACKER,
              label: 'ClientHello (SNI example.com)',
              fields: [{ name: 'server_name', value: 'example.com' }],
            }),
          ),
          set(ATTACKER, MODE, 'posing as example.com'),
        ],
      },
      {
        id: 'fake-cert',
        title: {
          en: 'A certificate the browser cannot trust',
          ja: 'ブラウザーが信頼できない証明書',
        },
        description: {
          en: 'The attacker presents its own self-signed certificate for example.com. The browser cannot build a chain to a trusted CA (RFC 5280 §6).',
          ja: '攻撃者は、自分で署名した example.com の証明書を出す。ブラウザーは信頼された CA までの連鎖を組めない（RFC 5280 §6）。',
        },
        events: [
          send(
            hop({
              id: 'fake-cert',
              from: ATTACKER,
              to: BROWSER,
              label: 'ServerHello … Finished (fake cert)',
              status: 'rejected',
              fields: [
                {
                  name: 'Certificate',
                  value: 'CN=example.com, self-signed',
                  highlight: true,
                  description: FIELD_TEXT.fakeCert,
                },
              ],
            }),
          ),
        ],
      },
      {
        id: 'alert',
        title: { en: 'Hard fail: no way to click through', ja: '打ち切り: 無視して進む手段はない' },
        description: {
          en: 'For a Known HSTS Host, any error in establishing the secure connection must end the connection (§8.4), and the browser should not offer a way to proceed anyway (§12.1). Without HSTS, browsers commonly show a warning that the user can click through (§14.2). The site never received anything. HSTS turns the attack into an error; it cannot stop the attacker from blocking the connection.',
          ja: '既知の HSTS ホストでは、安全な接続を確立するときの誤りはどれも、接続を打ち切らなければならない（§8.4）。ブラウザーは、それでも先へ進む手段を出すべきでない（§12.1）。HSTS がなければ、ブラウザーは利用者が無視して進める警告を出すことが多い（§14.2）。サイトには何も届いていない。HSTS は攻撃をエラーに変えるが、攻撃者が接続を妨げることは止められない。',
        },
        events: [
          send(
            hop({
              id: 'alert',
              from: BROWSER,
              to: ATTACKER,
              label: 'Alert: unknown_ca',
              encrypted: true,
              fields: [{ name: 'AlertDescription', value: 'unknown_ca (48)', highlight: true }],
            }),
          ),
          set(BROWSER, TLS, 'aborted: unknown_ca'),
          set(BROWSER, URL_KEY, 'error page (no proceed)'),
        ],
      },
    ]),
  ]
}

function buildSteps({ situation }: HstsOptions): readonly Step[] {
  switch (situation) {
    case 'noHsts':
    case 'expired':
      return strippedSteps(situation)
    case 'badCert':
      return badCertSteps()
    case 'known':
    case 'subdomain':
    case 'preload':
      return protectedSteps(situation)
  }
}

export const hstsScenario: Scenario<HstsOptions> = {
  id: 'hsts',
  title: { en: 'HSTS and SSL stripping', ja: 'HSTS と SSL ストリッピング' },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'noHsts',
          label: {
            en: 'Site without HSTS: stripped',
            ja: 'HSTS のないサイト: ストリッピングされる',
          },
        },
        {
          value: 'known',
          label: { en: 'HSTS known from an earlier visit', ja: '前の訪問で HSTS を知っている' },
        },
        {
          value: 'expired',
          label: {
            en: 'HSTS known, but max-age expired',
            ja: 'HSTS を知っていたが max-age が切れた',
          },
        },
        {
          value: 'badCert',
          label: {
            en: 'HSTS known, attacker’s own certificate',
            ja: 'HSTS を知っている、攻撃者の証明書',
          },
        },
        {
          value: 'subdomain',
          label: {
            en: 'includeSubDomains: opening www.example.com',
            ja: 'includeSubDomains: www.example.com を開く',
          },
        },
        {
          value: 'preload',
          label: {
            en: 'First visit, on the preload list',
            ja: '初めての訪問、プリロードリストにある',
          },
        },
      ],
      defaultValue: 'noHsts',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
