/**
 * HTTP のキャッシュ: Cache-Control と ETag
 *
 * 根拠:
 * - RFC 9111 §3（応答を保存する条件）、§4.2（新しい応答: freshness_lifetime > current_age のあいだだけ使える）、
 *   §4.2.1（max-age から freshness_lifetime を決める）、§4.2.3（Age の計算）、§4.3.1〜§4.3.4（条件付き要求による再検証と、
 *   304 で保存した応答を新しくする）
 * - RFC 9111 §5.2.2.1（max-age）、§5.2.2.4（no-cache: 保存してよいが、使う前に必ず再検証する）、§5.2.2.5（no-store: 保存しない）
 * - RFC 9110 §8.8.3（ETag）、§13.1.2（If-None-Match: 一致すれば 304、しなければ 200 で全体）、§15.3.1（200）、
 *   §15.4.5（304: 本文を持たず、200 なら付けたはずの Cache-Control・ETag などを付ける）
 * - RFC 9239（text/javascript）
 *
 * 学習用の単純化: ブラウザーのプライベートキャッシュだけを扱う（共有キャッシュ・CDN、s-maxage、Vary は扱わない）。
 * 検証子は ETag だけ（Last-Modified と If-Modified-Since、ヒューリスティックな鮮度、Expires は概要で触れる）。
 * Age は応答を受け取ってからの経過時間とし、Date と Age ヘッダーの計算は省く。HTTP は読めるよう暗号化せずに描く
 * （実際は HTTPS の上で送る。HTTPS のテーマを参照）
 */
import { z } from 'zod'
import type {
  Actor,
  Message,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  directive: z.enum(['maxAge', 'noCache', 'noStore']).catch('maxAge'),
  serverChange: z.stringbool().catch(false),
})
export type HttpCachingOptions = z.infer<typeof optionsSchema>
type Directive = HttpCachingOptions['directive']

const BROWSER = 'browser'
const SERVER = 'server'
const CACHE: StateKey = 'cache'
const DECISION: StateKey = 'decision'
const RESOURCE: StateKey = 'resource'

export const PATH = '/app.js'
export const MAX_AGE_S = 60
/** もう一度ページを開くまでの時間（秒） */
export const REVISIT_AGE_S = 5
export const CACHE_COLUMNS = ['URL', 'ETag', 'Cache-Control', 'Age', 'Status'] as const

const CACHE_CONTROL: Readonly<Record<Directive, string>> = {
  maxAge: `max-age=${String(MAX_AGE_S)}`,
  noCache: 'no-cache',
  noStore: 'no-store',
}

interface Version {
  readonly etag: string
  readonly body: string
  readonly length: number
}
const V1: Version = { etag: '"v1"', body: 'console.log("v1") …', length: 1200 }
const V2: Version = { etag: '"v2"', body: 'console.log("v2") …', length: 1250 }

const resourceText = (version: Version) => `${PATH} (ETag ${version.etag})`

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      {
        key: CACHE,
        label: { en: 'Browser cache', ja: 'ブラウザーのキャッシュ' },
        initial: { columns: CACHE_COLUMNS, rows: [] },
      },
      {
        key: DECISION,
        label: { en: 'Decision for this visit', ja: '今回の判断' },
        initial: '-',
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: RESOURCE,
        label: { en: 'Current file on the server', ja: 'サーバーにある今のファイル' },
        initial: resourceText(V1),
      },
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

function cacheTable(row: readonly string[] | null): StateTable {
  return { columns: CACHE_COLUMNS, rows: row === null ? [] : [row] }
}
function cacheRow(directive: Directive, version: Version, age: number): readonly string[] {
  const status = directive === 'noCache' ? 'no-cache' : age < MAX_AGE_S ? 'fresh' : 'stale'
  return [PATH, version.etag, CACHE_CONTROL[directive], String(age), status]
}

const REQUEST_LINE = {
  en: 'Method, path and HTTP version',
  ja: 'メソッド、パス、HTTP のバージョン',
}

function request(id: string, conditional: Version | null): Message {
  const fields: PacketField[] = [
    { name: 'Request line', value: `GET ${PATH} HTTP/1.1`, description: REQUEST_LINE },
    { name: 'Host', value: 'www.example.com' },
    { name: 'Accept', value: '*/*' },
  ]
  if (conditional !== null) {
    fields.push({
      name: 'If-None-Match',
      value: conditional.etag,
      highlight: true,
      description: {
        en: 'The ETag of the stored response: “send the file only if it is no longer this version”',
        ja: '保存している応答の ETag。「この版でなくなっていたら、ファイルを送って」という意味',
      },
    })
  }
  return {
    id,
    from: BROWSER,
    to: SERVER,
    label: conditional === null ? `GET ${PATH}` : `GET ${PATH} (If-None-Match)`,
    status: 'delivered',
    fields,
  }
}

const CACHE_CONTROL_TEXT: Readonly<Record<Directive, LocalizedText>> = {
  maxAge: {
    en: 'The response stays fresh for 60 seconds: until then the browser may use it without asking',
    ja: '応答は 60 秒のあいだ新しい。それまでは、ブラウザーはサーバーに尋ねずに使ってよい',
  },
  noCache: {
    en: 'The browser may store the response, but must revalidate it with the server before every use',
    ja: 'ブラウザーは応答を保存してよいが、使う前には毎回サーバーに確かめる',
  },
  noStore: {
    en: 'The browser must not store the response at all',
    ja: 'ブラウザーは応答をまったく保存しない',
  },
}

function ok(id: string, directive: Directive, version: Version): Message {
  return {
    id,
    from: SERVER,
    to: BROWSER,
    label: '200 OK',
    status: 'delivered',
    fields: [
      { name: 'Status line', value: 'HTTP/1.1 200 OK' },
      {
        name: 'Cache-Control',
        value: CACHE_CONTROL[directive],
        highlight: true,
        description: CACHE_CONTROL_TEXT[directive],
      },
      {
        name: 'ETag',
        value: version.etag,
        highlight: true,
        description: {
          en: 'A tag for this version of the file. It changes when the file changes',
          ja: 'このファイルの版を表す値。ファイルが変わると変わる',
        },
      },
      { name: 'Content-Type', value: 'text/javascript' },
      { name: 'Content-Length', value: String(version.length) },
      { name: 'Body', value: version.body },
    ],
  }
}

function notModified(id: string, directive: Directive, version: Version): Message {
  return {
    id,
    from: SERVER,
    to: BROWSER,
    label: '304 Not Modified',
    status: 'delivered',
    fields: [
      { name: 'Status line', value: 'HTTP/1.1 304 Not Modified' },
      {
        name: 'Cache-Control',
        value: CACHE_CONTROL[directive],
        description: CACHE_CONTROL_TEXT[directive],
      },
      { name: 'ETag', value: version.etag },
      {
        name: 'Body',
        value: '(none)',
        highlight: true,
        description: {
          en: 'A 304 has no body: the browser uses the file it already stored',
          ja: '304 には本文がない。ブラウザーは保存しているファイルを使う',
        },
      },
    ],
  }
}

function buildSteps(options: HttpCachingOptions): readonly Step[] {
  const { directive, serverChange } = options
  const stores = directive !== 'noStore'
  const latest = serverChange ? V2 : V1
  const steps: Step[] = [
    {
      id: 'first-request',
      title: { en: 'The browser asks for app.js', ja: 'ブラウザーが app.js を要求する' },
      description: {
        en: 'The page needs /app.js. Nothing is stored in the browser cache yet, so the browser sends an ordinary GET to the server.',
        ja: 'ページには /app.js が必要。ブラウザーのキャッシュにはまだ何もないので、ふつうの GET をサーバーに送る。',
      },
      events: [send(request('get1', null)), set(BROWSER, DECISION, 'miss')],
    },
    {
      id: 'first-response',
      title: {
        en: 'The server answers with the file and Cache-Control',
        ja: 'サーバーがファイルと Cache-Control を返す',
      },
      description: stores
        ? {
            en: `The response carries the whole file, an ETag that names this version, and Cache-Control: ${CACHE_CONTROL[directive]}. The browser stores the response in its cache.`,
            ja: `応答には、ファイル全体と、この版を表す ETag と、Cache-Control: ${CACHE_CONTROL[directive]} が入っている。ブラウザーは応答をキャッシュに保存する。`,
          }
        : {
            en: 'The response carries the whole file, an ETag, and Cache-Control: no-store. The browser uses the file but does not keep it: the cache stays empty.',
            ja: '応答には、ファイル全体と ETag と Cache-Control: no-store が入っている。ブラウザーはファイルを使うが保存しないので、キャッシュは空のまま。',
          },
      events: [
        send(ok('ok1', directive, V1)),
        set(BROWSER, CACHE, cacheTable(stores ? cacheRow(directive, V1, 0) : null)),
        ...(stores ? [] : [set(BROWSER, DECISION, 'no-store')]),
      ],
    },
  ]

  if (serverChange) {
    steps.push({
      id: 'deploy',
      title: { en: 'A new version is deployed', ja: '新しい版が公開される' },
      description: {
        en: 'The developers replace /app.js on the server. The new file has a different ETag, "v2". Nothing is sent to the browser: it only finds out the next time it asks.',
        ja: '開発者がサーバーの /app.js を置き換える。新しいファイルの ETag は "v2" に変わる。ブラウザーには何も送られないので、次に尋ねるまで気づかない。',
      },
      events: [set(SERVER, RESOURCE, resourceText(V2))],
    })
  }

  const revisitTitle = {
    en: `The page is opened again ${String(REVISIT_AGE_S)} seconds later`,
    ja: `${String(REVISIT_AGE_S)} 秒後にページをもう一度開く`,
  }

  if (directive === 'maxAge') {
    steps.push(
      {
        id: 'reuse-fresh',
        title: revisitTitle,
        description: {
          en: `The stored response is ${String(REVISIT_AGE_S)} seconds old, less than max-age=${String(MAX_AGE_S)}, so it is still fresh. The browser uses it straight from the cache and sends nothing.${serverChange ? ' The server already has v2, but the browser keeps using v1 until the response becomes stale.' : ''}`,
          ja: `保存した応答は ${String(REVISIT_AGE_S)} 秒前のもので、max-age=${String(MAX_AGE_S)} より新しい。ブラウザーはキャッシュからそのまま使い、何も送らない。${serverChange ? 'サーバーにはもう v2 があるが、応答が古くなるまでブラウザーは v1 を使い続ける。' : ''}`,
        },
        events: [
          set(BROWSER, CACHE, cacheTable(cacheRow(directive, V1, REVISIT_AGE_S))),
          set(BROWSER, DECISION, 'hit (fresh)'),
        ],
      },
      {
        id: 'expired',
        title: { en: 'max-age runs out', ja: 'max-age が過ぎる' },
        description: {
          en: `${String(MAX_AGE_S)} seconds after the response, its age is no longer less than max-age: the stored response is stale. It is not deleted; the next time the page is opened, the browser must check with the server before using it.`,
          ja: `応答から ${String(MAX_AGE_S)} 秒たつと、経過時間が max-age に達し、保存した応答は古く（stale に）なる。消すわけではなく、次にページを開いたときに、使う前にサーバーに確かめる。`,
        },
        events: [
          { kind: 'timer', actorId: BROWSER, name: 'max-age', durationMs: MAX_AGE_S * 1000 },
          set(BROWSER, CACHE, cacheTable(cacheRow(directive, V1, MAX_AGE_S))),
          set(BROWSER, DECISION, 'stale'),
        ],
      },
    )
  } else {
    steps.push({
      id: 'revisit',
      title: revisitTitle,
      description:
        directive === 'noCache'
          ? {
              en: `The response is only ${String(REVISIT_AGE_S)} seconds old, but it was stored with no-cache: the browser may not use it without asking the server first.`,
              ja: `応答はまだ ${String(REVISIT_AGE_S)} 秒前のものだが、no-cache 付きで保存したので、サーバーに確かめずには使えない。`,
            }
          : {
              en: 'Nothing was stored, so the browser has to download the whole file again.',
              ja: '何も保存していないので、ブラウザーはファイル全体をもう一度ダウンロードするしかない。',
            },
      events:
        directive === 'noCache'
          ? [
              set(BROWSER, CACHE, cacheTable(cacheRow(directive, V1, REVISIT_AGE_S))),
              set(BROWSER, DECISION, 'no-cache'),
            ]
          : [set(BROWSER, DECISION, 'miss')],
    })
  }

  if (!stores) {
    steps.push(
      {
        id: 'second-request',
        title: { en: 'The browser asks again', ja: 'ブラウザーがもう一度要求する' },
        description: {
          en: 'Without a stored response there is no ETag to send, so this is the same ordinary GET as the first time.',
          ja: '保存した応答がないので送る ETag もなく、1 回目と同じふつうの GET になる。',
        },
        events: [send(request('get2', null))],
      },
      {
        id: 'second-response',
        title: {
          en: 'The whole file is sent again',
          ja: 'ファイル全体がもう一度送られる',
        },
        description: {
          en: `The server sends the whole file (${String(latest.length)} bytes), and again the browser does not keep it. no-store suits responses that must never be left on the device, such as a bank statement, not static files like app.js.`,
          ja: `サーバーはまたファイル全体（${String(latest.length)} バイト）を送り、ブラウザーはまた保存しない。no-store は、銀行の明細のように端末に残してはいけない応答に使うもので、app.js のような静的なファイルには向かない。`,
        },
        events: [send(ok('ok2', directive, latest)), set(BROWSER, DECISION, 'no-store')],
      },
    )
    return steps
  }

  steps.push({
    id: 'conditional-request',
    title: {
      en: 'The browser revalidates with If-None-Match',
      ja: 'ブラウザーが If-None-Match で確かめる',
    },
    description: {
      en: 'Instead of downloading the file again, the browser sends a conditional request: If-None-Match carries the stored ETag, "v1". It means “send the file only if you no longer have this version”.',
      ja: 'ファイルをもう一度ダウンロードする代わりに、条件付きの要求を送る。If-None-Match に保存した ETag の "v1" を入れる。「この版でなくなっていたら送って」という意味。',
    },
    events: [send(request('get2', V1)), set(BROWSER, DECISION, 'If-None-Match "v1"')],
  })

  if (serverChange) {
    steps.push({
      id: 'modified',
      title: {
        en: 'The ETag differs: 200 with the new file',
        ja: 'ETag が違う: 200 で新しいファイル',
      },
      description: {
        en: 'The server’s current ETag is "v2", which does not match "v1", so it answers 200 with the whole new file. The browser replaces the stored response with it.',
        ja: 'サーバーの今の ETag は "v2" で "v1" と一致しないので、200 で新しいファイル全体を返す。ブラウザーは保存した応答を置き換える。',
      },
      events: [
        send(ok('ok2', directive, V2)),
        set(BROWSER, CACHE, cacheTable(cacheRow(directive, V2, 0))),
        set(BROWSER, DECISION, '200 (v2)'),
      ],
    })
    return steps
  }

  steps.push(
    {
      id: 'not-modified',
      title: {
        en: 'The ETag matches: 304 Not Modified',
        ja: 'ETag が一致する: 304 Not Modified',
      },
      description: {
        en: 'The file has not changed, so the server answers 304 Not Modified with no body. It still sends ETag and Cache-Control; the browser updates the stored response with them, and the age starts from 0 again.',
        ja: 'ファイルは変わっていないので、サーバーは本文のない 304 Not Modified を返す。ETag と Cache-Control は付ける。ブラウザーはそれで保存した応答を更新し、経過時間は 0 に戻る。',
      },
      events: [
        send(notModified('not-modified', directive, V1)),
        set(BROWSER, CACHE, cacheTable(cacheRow(directive, V1, 0))),
      ],
    },
    {
      id: 'reuse-validated',
      title: {
        en: 'The browser uses the stored file',
        ja: 'ブラウザーが保存したファイルを使う',
      },
      description: {
        en: `The browser uses the file it already had. Only a small 304 crossed the network instead of all ${String(V1.length)} bytes. On a real page with many large files, this saves a lot of time and data.`,
        ja: `ブラウザーはもともと持っていたファイルを使う。ネットワークを流れたのは ${String(V1.length)} バイトのファイル全体ではなく、小さな 304 だけ。大きなファイルがたくさんある実際のページでは、時間とデータ量を大きく節約できる。`,
      },
      events: [set(BROWSER, DECISION, 'hit (revalidated)')],
    },
  )
  return steps
}

export const httpCachingScenario: Scenario<HttpCachingOptions> = {
  id: 'http-caching',
  title: {
    en: 'HTTP caching: Cache-Control and ETag',
    ja: 'HTTP のキャッシュ: Cache-Control と ETag',
  },
  actors,
  optionDefs: {
    directive: {
      kind: 'select',
      label: { en: 'Cache-Control from the server', ja: 'サーバーが返す Cache-Control' },
      choices: [
        { value: 'maxAge', label: { en: 'max-age=60', ja: 'max-age=60' } },
        {
          value: 'noCache',
          label: { en: 'no-cache (always revalidate)', ja: 'no-cache（毎回確かめる）' },
        },
        { value: 'noStore', label: { en: 'no-store (never store)', ja: 'no-store（保存しない）' } },
      ],
      defaultValue: 'maxAge',
    },
    serverChange: {
      kind: 'toggle',
      label: {
        en: 'A new version is deployed in between',
        ja: '途中で新しい版が公開される',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
