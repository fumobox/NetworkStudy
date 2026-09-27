/**
 * CORS: オリジンをまたぐ要求とプリフライト
 *
 * 根拠（CORS には RFC がないため、WHATWG の Fetch Standard を節の名前とアンカーで引く。
 * Living Standard は節番号が変わるので番号は書かない。https://fetch.spec.whatwg.org/ 、2026 年 9 月に参照）:
 * - "CORS protocol"（#cors-protocol）: Origin、Access-Control-Allow-Origin（オリジンそのもの、または *）、
 *   Access-Control-Allow-Credentials、プリフライトの要求と応答のヘッダー、Vary: Origin
 * - "CORS protocol and credentials"（#cors-protocol-and-credentials）: 資格情報（Cookie）付きの要求では * を使えず、
 *   Access-Control-Allow-Credentials: true が要る
 * - "CORS-safelisted method"（#cors-safelisted-method）、"CORS-safelisted request-header"（#cors-safelisted-request-header）:
 *   GET・HEAD・POST と、決まったヘッダー（Content-Type は application/x-www-form-urlencoded、multipart/form-data、text/plain のみ）
 *   だけならプリフライトは要らない
 * - "CORS-preflight fetch"（#cors-preflight-fetch）: OPTIONS に Access-Control-Request-Method と
 *   Access-Control-Request-Headers（小文字）を付け、資格情報は付けずに送る。"CORS-preflight cache"（#concept-cache）
 * - "CORS check"（#concept-cors-check）: 失敗すると network error になり、スクリプトには TypeError だけが見える
 * - RFC 6454 §4、§5（オリジン = スキーム・ホスト・ポート）、RFC 9110 §9.3.7（OPTIONS）
 * - 2014 年の W3C の CORS 勧告は Fetch Standard に置き換えられた
 *
 * 学習用の単純化: ページのオリジンは 1 つ。Access-Control-Expose-Headers、リダイレクト、Private Network Access、
 * プリフライトのキャッシュの上限（ブラウザーごとに違う）は扱わない。HTTP は読めるよう暗号化せずに描く（実際は HTTPS）
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
  request: z.enum(['jsonPost', 'simpleGet']).catch('jsonPost'),
  serverPolicy: z.enum(['exactOrigin', 'wildcard', 'notAllowed']).catch('exactOrigin'),
  credentials: z.stringbool().catch(false),
})
export type CorsOptions = z.infer<typeof optionsSchema>
type ServerPolicy = CorsOptions['serverPolicy']

const SCRIPT = 'script'
const BROWSER = 'browser'
const API = 'api'
const RESULT: StateKey = 'result'
const CORS_CHECK: StateKey = 'corsCheck'
const PREFLIGHT_CACHE: StateKey = 'preflightCache'
const LAST_REQUEST: StateKey = 'lastRequest'

export const PAGE_ORIGIN = 'https://app.example.com'
export const API_ORIGIN = 'https://api.example.com'
const URL = `${API_ORIGIN}/items`
export const PREFLIGHT_COLUMNS = ['URL', 'Method', 'Headers', 'Max-Age'] as const
const MAX_AGE = '600'
const COOKIE = 'session=abc123'

const actors: readonly Actor[] = [
  {
    id: SCRIPT,
    kind: 'client',
    name: { en: `Page script (${PAGE_ORIGIN})`, ja: `ページのスクリプト（${PAGE_ORIGIN}）` },
    shortName: { en: 'Script', ja: 'スクリプト' },
    stateSlots: [
      { key: RESULT, label: { en: 'Result of fetch()', ja: 'fetch() の結果' }, initial: 'pending' },
    ],
  },
  {
    id: BROWSER,
    kind: 'client',
    name: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: CORS_CHECK, label: { en: 'CORS check', ja: 'CORS のチェック' }, initial: '-' },
      {
        key: PREFLIGHT_CACHE,
        label: { en: 'Preflight cache', ja: 'プリフライトのキャッシュ' },
        initial: { columns: PREFLIGHT_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: API,
    kind: 'server',
    name: { en: `API server (${API_ORIGIN})`, ja: `API サーバー（${API_ORIGIN}）` },
    shortName: { en: 'API server', ja: 'API サーバー' },
    stateSlots: [
      {
        key: LAST_REQUEST,
        label: { en: 'Requests the server handled', ja: 'サーバーが処理した要求' },
        initial: '-',
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

const ORIGIN_TEXT: LocalizedText = {
  en: 'The origin (scheme, host and port) of the page that made the request. The browser adds it; the script cannot change it',
  ja: '要求したページのオリジン（スキーム・ホスト・ポート）。ブラウザーが付け、スクリプトは変えられない',
}
const ACAO_TEXT: LocalizedText = {
  en: 'Which origin may read the response. The browser compares it with the page’s origin',
  ja: 'どのオリジンが応答を読んでよいか。ブラウザーはページのオリジンと比べる',
}
const ACAC_TEXT: LocalizedText = {
  en: 'Allows the page to read responses to requests sent with cookies',
  ja: 'Cookie 付きの要求への応答を、ページが読んでよいことを示す',
}

/** サーバーが CORS の応答に付けるヘッダー。notAllowed なら付けない */
function allowHeaders(policy: ServerPolicy): PacketField[] {
  if (policy === 'notAllowed') {
    return [
      {
        name: 'Access-Control-Allow-Origin',
        value: '(none)',
        highlight: true,
        description: {
          en: 'The server does not allow other origins, so it sends no CORS headers',
          ja: 'サーバーはほかのオリジンを許していないので、CORS のヘッダーを付けない',
        },
      },
    ]
  }
  if (policy === 'wildcard') {
    return [
      {
        name: 'Access-Control-Allow-Origin',
        value: '*',
        highlight: true,
        description: {
          en: 'Any origin may read the response, but only for requests without cookies',
          ja: 'どのオリジンでも応答を読んでよい。ただし Cookie のない要求に限る',
        },
      },
    ]
  }
  return [
    {
      name: 'Access-Control-Allow-Origin',
      value: PAGE_ORIGIN,
      highlight: true,
      description: ACAO_TEXT,
    },
    {
      name: 'Access-Control-Allow-Credentials',
      value: 'true',
      description: ACAC_TEXT,
    },
    {
      name: 'Vary',
      value: 'Origin',
      description: {
        en: 'The answer depends on Origin, so caches must not reuse it for another origin',
        ja: '応答が Origin によって変わるので、キャッシュはほかのオリジンに使い回してはいけない',
      },
    },
  ]
}

/** CORS のチェックに通るか（通らないときは理由の用語） */
function corsFailure(policy: ServerPolicy, credentials: boolean): string | null {
  if (policy === 'notAllowed') {
    return 'no Access-Control-Allow-Origin'
  }
  if (policy === 'wildcard' && credentials) {
    return '* with credentials'
  }
  return null
}

function buildSteps(options: CorsOptions): readonly Step[] {
  const { request, serverPolicy, credentials } = options
  const post = request === 'jsonPost'
  const method = post ? 'POST' : 'GET'
  const failure = corsFailure(serverPolicy, credentials)
  const credentialsMode = credentials ? 'include' : 'same-origin (default)'

  const fetchFields: PacketField[] = [
    { name: 'URL', value: URL },
    { name: 'method', value: method },
    {
      name: 'headers',
      value: post ? 'Content-Type: application/json' : '(none)',
      highlight: post,
      description: post
        ? {
            en: 'application/json is not one of the Content-Type values allowed without a preflight',
            ja: 'application/json は、プリフライトなしで送れる Content-Type ではない',
          }
        : {
            en: 'No extra headers: a GET like this can be sent without a preflight',
            ja: '追加のヘッダーはない。このような GET はプリフライトなしで送れる',
          },
    },
    {
      name: 'credentials',
      value: credentialsMode,
      description: credentials
        ? {
            en: 'Send cookies for api.example.com even though it is another origin',
            ja: '別のオリジンでも、api.example.com の Cookie を送る',
          }
        : {
            en: 'Cookies are sent only to the page’s own origin, so none go to api.example.com',
            ja: 'Cookie はページと同じオリジンにだけ送るので、api.example.com には送らない',
          },
    },
  ]
  if (post) {
    fetchFields.push({ name: 'body', value: '{"name":"pen"}' })
  }

  const steps: Step[] = [
    {
      id: 'fetch-call',
      title: {
        en: 'The page calls fetch() for another origin',
        ja: 'ページが別のオリジンに fetch() する',
      },
      description: post
        ? {
            en: `The page at ${PAGE_ORIGIN} wants to POST JSON to ${API_ORIGIN}. The host differs, so this is a cross-origin request. Because of the JSON Content-Type, the browser must ask the server first: a preflight.`,
            ja: `${PAGE_ORIGIN} のページが、${API_ORIGIN} に JSON を POST したい。ホストが違うので、オリジンをまたぐ要求になる。Content-Type が JSON なので、ブラウザーは先にサーバーに尋ねる。これがプリフライト。`,
          }
        : {
            en: `The page at ${PAGE_ORIGIN} wants to GET data from ${API_ORIGIN}, another origin. A plain GET with no extra headers can be sent without a preflight, but the browser will still check the response.`,
            ja: `${PAGE_ORIGIN} のページが、別のオリジンの ${API_ORIGIN} からデータを GET したい。追加のヘッダーのない GET はプリフライトなしで送れるが、ブラウザーは応答を確かめる。`,
          },
      events: [
        send({
          id: 'fetch',
          from: SCRIPT,
          to: BROWSER,
          label: 'fetch()',
          status: 'delivered',
          fields: fetchFields,
        }),
        set(BROWSER, CORS_CHECK, post ? 'preflight' : 'no preflight'),
      ],
    },
  ]

  const failSteps = (atPreflight: boolean): Step[] => [
    {
      id: 'network-error',
      title: {
        en: 'The script only sees a TypeError',
        ja: 'スクリプトには TypeError だけが見える',
      },
      description: {
        en: `The CORS check failed, so the browser reports a network error. The script gets a TypeError and cannot see the status or the reason; the reason is only shown in the browser’s developer console.${atPreflight ? ` The ${method} itself was never sent.` : ' Note that the server did receive and handle the GET: CORS only stops the page from reading the response.'}`,
        ja: `CORS のチェックに通らなかったので、ブラウザーはネットワークエラーとして扱う。スクリプトには TypeError が返るだけで、ステータスも理由もわからない。理由はブラウザーの開発者ツールのコンソールにだけ出る。${atPreflight ? `${method} そのものは送られていない。` : 'サーバーは GET を受け取って処理していることに注意。CORS が止めるのは、ページが応答を読むことだけ。'}`,
      },
      events: [
        send({
          id: 'type-error',
          from: BROWSER,
          to: SCRIPT,
          label: 'TypeError',
          status: 'delivered',
          fields: [{ name: 'message', value: 'Failed to fetch' }],
        }),
        set(SCRIPT, RESULT, 'TypeError'),
      ],
    },
  ]

  const failureText: LocalizedText =
    failure === '* with credentials'
      ? {
          en: 'The request is sent with cookies, but the server answered Access-Control-Allow-Origin: *. With credentials, * is not accepted: the server must name the origin and send Access-Control-Allow-Credentials: true. The check fails.',
          ja: '要求は Cookie 付きなのに、サーバーは Access-Control-Allow-Origin: * を返した。資格情報付きの要求では * は認められず、オリジンを名指しして Access-Control-Allow-Credentials: true を付ける必要がある。チェックに通らない。',
        }
      : {
          en: 'The response has no Access-Control-Allow-Origin, so nothing allows the page’s origin to read it. The check fails.',
          ja: '応答に Access-Control-Allow-Origin がないので、ページのオリジンに読むことを許すものがない。チェックに通らない。',
        }

  if (post) {
    const preflightFields: PacketField[] = [
      { name: 'Request line', value: 'OPTIONS /items HTTP/1.1' },
      { name: 'Host', value: 'api.example.com' },
      { name: 'Origin', value: PAGE_ORIGIN, highlight: true, description: ORIGIN_TEXT },
      {
        name: 'Access-Control-Request-Method',
        value: 'POST',
        highlight: true,
        description: {
          en: 'The method the page wants to use',
          ja: 'ページが使いたいメソッド',
        },
      },
      {
        name: 'Access-Control-Request-Headers',
        value: 'content-type',
        highlight: true,
        description: {
          en: 'The headers the page wants to send that need permission (lower case)',
          ja: 'ページが送りたい、許可の要るヘッダー（小文字）',
        },
      },
    ]
    if (credentials) {
      preflightFields.push({
        name: 'Cookie',
        value: '(not sent)',
        description: {
          en: 'A preflight never carries cookies, even when the actual request will',
          ja: '本番の要求が Cookie 付きでも、プリフライトには Cookie を付けない',
        },
      })
    }
    steps.push({
      id: 'preflight',
      title: {
        en: 'The browser sends a preflight (OPTIONS)',
        ja: 'ブラウザーがプリフライト（OPTIONS）を送る',
      },
      description: {
        en: 'Before sending the POST, the browser asks the server whether this origin may use POST with a Content-Type header. The request has no body; the page’s script cannot see or change it.',
        ja: 'POST を送る前に、このオリジンが Content-Type ヘッダー付きの POST を使ってよいかをサーバーに尋ねる。本文はなく、ページのスクリプトからは見えないし変えられない。',
      },
      events: [
        send({
          id: 'preflight',
          from: BROWSER,
          to: API,
          label: 'OPTIONS /items',
          status: 'delivered',
          fields: preflightFields,
        }),
        set(API, LAST_REQUEST, 'OPTIONS /items'),
      ],
    })

    const preflightResponseFields: PacketField[] = [
      { name: 'Status line', value: 'HTTP/1.1 204 No Content' },
      ...allowHeaders(serverPolicy),
    ]
    if (serverPolicy !== 'notAllowed') {
      preflightResponseFields.push(
        { name: 'Access-Control-Allow-Methods', value: 'POST' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        {
          name: 'Access-Control-Max-Age',
          value: MAX_AGE,
          description: {
            en: 'The browser may reuse this answer for 600 seconds without another preflight',
            ja: 'ブラウザーは 600 秒のあいだ、プリフライトなしでこの答えを使い回してよい',
          },
        },
      )
    }
    steps.push({
      id: 'preflight-response',
      title:
        failure === null
          ? { en: 'The server allows it', ja: 'サーバーが許可する' }
          : { en: 'The preflight fails', ja: 'プリフライトに通らない' },
      description:
        failure === null
          ? {
              en: 'The answer allows the page’s origin, POST and Content-Type. The browser remembers it in the preflight cache for 600 seconds and goes on to send the real request.',
              ja: '答えは、ページのオリジンと POST と Content-Type を許している。ブラウザーはそれを 600 秒のあいだプリフライトのキャッシュに覚え、本番の要求を送る。',
            }
          : failureText,
      events: [
        send({
          id: 'preflight-response',
          from: API,
          to: BROWSER,
          label: '204 No Content',
          status: failure === null ? 'delivered' : 'rejected',
          fields: preflightResponseFields,
        }),
        ...(failure === null
          ? [
              set(BROWSER, CORS_CHECK, 'preflight OK'),
              set(BROWSER, PREFLIGHT_CACHE, {
                columns: PREFLIGHT_COLUMNS,
                rows: [[URL, 'POST', 'content-type', MAX_AGE]],
              }),
            ]
          : [set(BROWSER, CORS_CHECK, `failed (${failure})`)]),
      ],
    })
    if (failure !== null) {
      steps.push(...failSteps(true))
      return steps
    }
  }

  const requestFields: PacketField[] = [
    { name: 'Request line', value: `${method} /items HTTP/1.1` },
    { name: 'Host', value: 'api.example.com' },
    { name: 'Origin', value: PAGE_ORIGIN, highlight: true, description: ORIGIN_TEXT },
  ]
  if (post) {
    requestFields.push({ name: 'Content-Type', value: 'application/json' })
  }
  if (credentials) {
    requestFields.push({
      name: 'Cookie',
      value: COOKIE,
      highlight: true,
      description: {
        en: 'Sent because the page asked for credentials: include',
        ja: 'ページが credentials: include を指定したので付く',
      },
    })
  }
  if (post) {
    requestFields.push({ name: 'Body', value: '{"name":"pen"}' })
  }
  const handled = post ? 'POST /items → 201' : 'GET /items → 200'
  steps.push({
    id: 'actual-request',
    title: { en: `The browser sends the ${method}`, ja: `ブラウザーが ${method} を送る` },
    description: post
      ? {
          en: 'Now the real POST goes out, again with Origin. The server creates the item.',
          ja: 'ここで本番の POST を送る。これにも Origin が付く。サーバーは項目を作る。',
        }
      : {
          en: 'The GET goes straight to the server with an Origin header. The server handles it like any other request.',
          ja: 'GET は Origin ヘッダーを付けて、そのままサーバーに届く。サーバーはほかの要求と同じように処理する。',
        },
    events: [
      send({
        id: 'request',
        from: BROWSER,
        to: API,
        label: `${method} /items`,
        status: 'delivered',
        fields: requestFields,
      }),
      set(API, LAST_REQUEST, post ? `OPTIONS /items, ${handled}` : handled),
    ],
  })

  const status = post ? '201 Created' : '200 OK'
  steps.push({
    id: 'actual-response',
    title:
      failure === null
        ? { en: 'The response passes the CORS check', ja: '応答が CORS のチェックに通る' }
        : { en: 'The response fails the CORS check', ja: '応答が CORS のチェックに通らない' },
    description:
      failure === null
        ? {
            en: `The response carries Access-Control-Allow-Origin${serverPolicy === 'wildcard' ? ': *, and the request had no cookies' : ` naming ${PAGE_ORIGIN}${credentials ? ', and Access-Control-Allow-Credentials: true for the cookies' : ''}`}. The browser lets the page read it.`,
            ja: `応答には Access-Control-Allow-Origin が付いている（${serverPolicy === 'wildcard' ? '* で、要求に Cookie はない' : `${PAGE_ORIGIN} を名指ししている${credentials ? '。Cookie のために Access-Control-Allow-Credentials: true もある' : ''}`}）。ブラウザーはページに応答を読ませる。`,
          }
        : failureText,
    events: [
      send({
        id: 'response',
        from: API,
        to: BROWSER,
        label: status,
        status: failure === null ? 'delivered' : 'rejected',
        fields: [
          { name: 'Status line', value: `HTTP/1.1 ${status}` },
          ...allowHeaders(serverPolicy),
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Body', value: post ? '{"id":42,"name":"pen"}' : '[{"id":42,"name":"pen"}]' },
        ],
      }),
      set(BROWSER, CORS_CHECK, failure === null ? 'OK' : `failed (${failure})`),
    ],
  })

  if (failure !== null) {
    steps.push(...failSteps(false))
    return steps
  }
  steps.push({
    id: 'resolve',
    title: { en: 'The script gets the response', ja: 'スクリプトが応答を受け取る' },
    description: {
      en: 'fetch() resolves with the response, and the script can read the JSON body.',
      ja: 'fetch() が応答で完了し、スクリプトは JSON の本文を読める。',
    },
    events: [
      send({
        id: 'resolve',
        from: BROWSER,
        to: SCRIPT,
        label: `Response (${status.slice(0, 3)})`,
        status: 'delivered',
        fields: [
          { name: 'status', value: status.slice(0, 3) },
          { name: 'body', value: post ? '{"id":42,"name":"pen"}' : '[{"id":42,"name":"pen"}]' },
        ],
      }),
      set(SCRIPT, RESULT, `Response ${status.slice(0, 3)}`),
    ],
  })
  return steps
}

export const corsScenario: Scenario<CorsOptions> = {
  id: 'cors',
  title: {
    en: 'CORS: cross-origin requests and preflight',
    ja: 'CORS: オリジンをまたぐ要求とプリフライト',
  },
  actors,
  optionDefs: {
    request: {
      kind: 'select',
      label: { en: 'Request from the page', ja: 'ページの要求' },
      choices: [
        {
          value: 'jsonPost',
          label: {
            en: 'POST with JSON (needs a preflight)',
            ja: 'JSON の POST（プリフライトが要る）',
          },
        },
        {
          value: 'simpleGet',
          label: { en: 'Plain GET (no preflight)', ja: 'ふつうの GET（プリフライトなし）' },
        },
      ],
      defaultValue: 'jsonPost',
    },
    serverPolicy: {
      kind: 'select',
      label: { en: 'Server’s CORS setting', ja: 'サーバーの CORS の設定' },
      choices: [
        {
          value: 'exactOrigin',
          label: { en: `Allow ${PAGE_ORIGIN}`, ja: `${PAGE_ORIGIN} を許可` },
        },
        {
          value: 'wildcard',
          label: { en: 'Allow any origin (*)', ja: 'すべてのオリジンを許可（*）' },
        },
        { value: 'notAllowed', label: { en: 'Not configured', ja: '設定なし' } },
      ],
      defaultValue: 'exactOrigin',
    },
    credentials: {
      kind: 'toggle',
      label: {
        en: 'Send cookies (credentials: include)',
        ja: 'Cookie を送る（credentials: include）',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
