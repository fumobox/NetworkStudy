/**
 * Server-Sent Events（SSE）: 終わらない応答と自動の再接続
 *
 * 根拠:
 * - HTML Standard（WHATWG, Living Standard、2026 年 9 月に参照）「Server-sent events」。節の番号は変わるので、名前とアンカーで引く
 *   - 「The EventSource interface」（#the-eventsource-interface）: readyState の CONNECTING / OPEN / CLOSED。
 *     Accept: text/event-stream は付けてよい（may）。cache mode は "no-store"。状態コードが 200 でないか、Content-Type が
 *     text/event-stream でなければ fail the connection。ネットワークエラーと本文の終わりでは reestablish the connection
 *     （中断された（aborted）ときだけ fail）
 *   - 「Processing model」（#sse-processing-model）: announce（OPEN、open）。reestablish（CONNECTING、error、reconnection time
 *     待ってから、さらに待ってもよい。最後のイベント ID が空でなければ Last-Event-ID を付ける）。fail（CLOSED、error、以後は再接続しない）
 *   - 「The `Last-Event-ID` header」（#the-last-event-id-header）。reconnection time の初期値は実装が決める
 *   - 「Parsing an event stream」（#parsing-an-event-stream）、「Interpreting an event stream」（#event-stream-interpretation）:
 *     解析の手順は eventStream.ts。仕様の例は eventStream.test.ts で再現する
 *   - 「Authoring notes」（#authoring-notes）: 15 秒ごとのコメント、サーバーごとの接続数の制限と、その対策（接続ごとに別のドメイン名、ページごとの切り替え、共有ワーカー）
 *   - 「Introduction」（#server-sent-events-intro、非規範）: 204 No Content で再接続を止める
 * - Fetch Standard（WHATWG）「HTTP-network-or-cache fetch」: cache mode "no-store" では Pragma: no-cache と Cache-Control: no-cache を足す
 * - RFC 9110 §6.1（完全なメッセージ）、§8.3・§8.3.1（Content-Type）、§15.3.1（200）、§15.3.5（204 は内容を持たない）
 * - RFC 9112 §6.3（本文の長さ）、§8（最後のチャンクが届かない chunked の本文は不完全）、§7.1（chunked。サイズは 16 進、最後のチャンクは 0）、§9.3（持続的な接続）、
 *   §9.4（同時の接続の数は決めない。以前の RFC 2616 §8.1.4 は 2 本）
 * - RFC 9113 §5.1.1（クライアントのストリームは奇数）、§6.5.2（SETTINGS_MAX_CONCURRENT_STREAMS。100 以上を推奨）、
 *   §8.1（chunked は使えない）、§8.2・§8.2.2（小文字のフィールド名、Transfer-Encoding を入れない）
 * - RFC 2606（example.com）
 * - 標準でないもの: HTTP/1.1 でサーバーごとに約 6 本という上限と、タブの間で接続を共有することはブラウザーの動き。
 *   Last-Event-ID の後のイベントを送り直すのはアプリケーションの仕事（HTML は再送のしかたを決めない）
 *
 * 学習用の単純化: TCP と TLS の接続はできているものとし、HTTP は読めるよう暗号化せずに描く（実際は https）。TCP は FIN だけを描く。
 * 1 つのチャンクを 1 つのメッセージとして描き、イベントの区切りとチャンクの区切りをそろえる（実際はずれてよく、解析の関数はそれを扱う）。
 * retry: 5000 はサーバーが送る例の値で、ブラウザーの追加の待ち（バックオフ）は描かない。サーバーは最近のイベントを保存していて、
 * 再送できるものとする。ヘッダーは User-Agent、Cookie などを省く。6 つのタブは表の行で示す。HTTP/2 では接続の序文、SETTINGS の ACK、
 * WINDOW_UPDATE、HPACK を省く。MAX_CONCURRENT_STREAMS の 100 とハートビートの 15 秒は例の値
 */
import { z } from 'zod'
import type {
  Actor,
  Message,
  MessageId,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { chunkSizeHex } from './chunked'
import {
  feed,
  INITIAL_STREAM_STATE,
  serializeEvent,
  type EventSpec,
  type StreamState,
} from './eventStream'
import { afterEnd, checkResponse, reconnectHeaders, type ReadyState } from './reconnect'

const SITUATIONS = ['normal', 'reconnect', 'stop204', 'wrongType', 'http1Limit', 'http2'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('normal'),
})
export type SseOptions = z.infer<typeof optionsSchema>

const BROWSER = 'browser'
const SERVER = 'server'

const READY_STATE: StateKey = 'readyState'
const RECONNECTION: StateKey = 'reconnectionTime'
const LAST_EVENT_ID: StateKey = 'lastEventId'
const EVENTS: StateKey = 'events'
const CONNECTIONS: StateKey = 'connections'
const STREAMS: StateKey = 'streams'
const LOG: StateKey = 'log'
const ID_SEEN: StateKey = 'lastEventIdSeen'
const FEED: StateKey = 'feed'
export const EVENT_COLUMNS = ['type', 'data', 'lastEventId'] as const
export const CONNECTION_COLUMNS = ['Conn', 'Request', 'State'] as const
export const LOG_COLUMNS = ['id', 'event', 'data'] as const

export const HOST = 'www.example.com'
export const RETRY_MS = 5000
export const HEARTBEAT_MS = 15_000
export const MAX_STREAMS = 100

/** サーバーが配信するイベント（アプリケーションのデータ） */
interface LoggedEvent extends EventSpec {
  readonly id: string
}
const E1: LoggedEvent = { id: '1', event: 'price', data: 'EXMPL 101.5' }
const E2: LoggedEvent = { id: '2', event: 'news', data: 'Q3 results\nat 15:00' }
const E3: LoggedEvent = { id: '3', data: 'Market closes in 10 min' }
const E4: LoggedEvent = { id: '4', event: 'price', data: 'EXMPL 102.0' }
export const EVENT_LOG: readonly LoggedEvent[] = [E1, E2, E3, E4]

/** Last-Event-ID より後のイベント（知らない ID ならすべて。アプリケーションの決め方） */
export function eventsAfter(log: readonly LoggedEvent[], lastEventId: string) {
  const index = log.findIndex((entry) => entry.id === lastEventId)
  return index === -1 ? [...log] : log.slice(index + 1)
}

const CHUNK_1 = serializeEvent({ ...E1, retry: RETRY_MS })
const CHUNK_2 = serializeEvent(E2)
const HEARTBEAT = ': keep-alive\n\n'
const CHUNK_3 = serializeEvent(E3)
const REPLAY = eventsAfter(EVENT_LOG, '2').map(serializeEvent).join('')

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: `Browser (page on https://${HOST})`, ja: `ブラウザー（https://${HOST} のページ）` },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      {
        key: READY_STATE,
        label: { en: 'readyState (EventSource, tab 1)', ja: 'readyState（EventSource、タブ 1）' },
        initial: '-',
      },
      {
        key: RECONNECTION,
        label: { en: 'Reconnection time', ja: '再接続の待ち時間' },
        initial: 'UA default',
      },
      {
        key: LAST_EVENT_ID,
        label: { en: 'Last event ID string', ja: '最後のイベント ID' },
        initial: '""',
      },
      {
        key: EVENTS,
        label: { en: 'Events fired at the page', ja: 'ページに届いたイベント' },
        initial: { columns: EVENT_COLUMNS, rows: [] },
      },
      {
        key: CONNECTIONS,
        label: { en: `Connections to ${HOST}`, ja: `${HOST} への接続` },
        initial: { columns: CONNECTION_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: HOST, ja: HOST },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: STREAMS,
        label: { en: 'Open event streams', ja: '開いているイベントストリーム' },
        initial: '0',
      },
      {
        key: LOG,
        label: { en: 'Recent events (kept for replay)', ja: '最近のイベント（再送用に保存）' },
        initial: { columns: LOG_COLUMNS, rows: [] },
      },
      {
        key: ID_SEEN,
        label: { en: 'Last-Event-ID received', ja: '受け取った Last-Event-ID' },
        initial: '-',
      },
      { key: FEED, label: { en: 'Feed', ja: '配信' }, initial: 'live' },
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
const timer = (actorId: string, name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name,
  durationMs,
})

const FIELD_TEXT = {
  accept: {
    en: 'EventSource may send this; the server does not need it to decide anything',
    ja: 'EventSource は付けてよい（may）。サーバーがこれで何かを決める必要はない',
  },
  noCache: {
    en: 'EventSource fetches with cache mode "no-store", so the browser adds these (Fetch Standard)',
    ja: 'EventSource は cache mode "no-store" で取りにいくので、ブラウザーがこれを付ける（Fetch Standard）',
  },
  eventStream: {
    en: 'The body is text/event-stream: lines of field: value, and a blank line ends each event',
    ja: '本文は text/event-stream。「フィールド: 値」の行が並び、空行でイベントが終わる',
  },
  chunked: {
    en: 'The length is not known, so the response can go on. HTTP/1.1 sends the body in chunks (RFC 9112 §7.1)',
    ja: '長さが決まっていないので、応答は続けられる。HTTP/1.1 は本文をチャンクで送る（RFC 9112 §7.1）',
  },
  chunkSize: {
    en: 'The chunk’s length in bytes, in hexadecimal',
    ja: 'チャンクのバイト数を 16 進で',
  },
  lines: {
    en: 'The event stream text. \\n marks a line end',
    ja: 'イベントストリームの文字列。\\n は行の終わり',
  },
  lastEventId: {
    en: 'The last event ID the page received, so the server can send what came after it',
    ja: 'ページが最後に受け取ったイベント ID。サーバーはその後のイベントを送れる',
  },
} satisfies Record<string, LocalizedText>

const showLineFeeds = (text: string) => text.replace(/\n/g, '\\n')

// ---------- ブラウザー側の状態（解析の関数で作る） ----------

/** ブラウザーの EventSource と接続の表。イベントの行は解析の関数の出力から作る */
class BrowserModel {
  parser: StreamState = INITIAL_STREAM_STATE
  rows: string[][] = []
  connections: string[][] = []
  ready: ReadyState = 'CONNECTING'

  table(): StepEvent {
    return set(BROWSER, EVENTS, { columns: EVENT_COLUMNS, rows: this.rows.map((row) => [...row]) })
  }

  conns(): StepEvent {
    return set(BROWSER, CONNECTIONS, {
      columns: CONNECTION_COLUMNS,
      rows: this.connections.map((row) => [...row]),
    })
  }

  fire(type: 'open' | 'error'): StepEvent[] {
    this.rows.push([type, '-', '-'])
    return [this.table()]
  }

  /** 届いたチャンクを解析し、出たイベントを表に足す */
  receive(chunk: string): StepEvent[] {
    const result = feed(this.parser, chunk)
    this.parser = result.state
    for (const event of result.events) {
      this.rows.push([event.type, showLineFeeds(event.data), event.lastEventId])
    }
    return [
      this.table(),
      set(BROWSER, LAST_EVENT_ID, this.parser.lastEventId === '' ? '""' : this.parser.lastEventId),
      set(
        BROWSER,
        RECONNECTION,
        this.parser.reconnectionTime === null
          ? 'UA default'
          : `${String(this.parser.reconnectionTime)} ms`,
      ),
    ]
  }

  /** 新しい応答は新しいストリーム（BOM や途中の行は持ち越さない。最後のイベント ID と待ち時間は残す） */
  newStream(): StepEvent[] {
    this.parser = {
      ...INITIAL_STREAM_STATE,
      lastEventId: this.parser.lastEventId,
      lastEventIdBuffer: this.parser.lastEventIdBuffer,
      reconnectionTime: this.parser.reconnectionTime,
    }
    return []
  }

  setReady(state: ReadyState): StepEvent {
    this.ready = state
    return set(BROWSER, READY_STATE, state)
  }

  /** 待っていた要求に接続を割り当てる */
  assign(request: string, conn: string, state: string): StepEvent {
    const row = this.connections.find((candidate) => candidate[1] === request)
    if (row !== undefined) {
      row[0] = conn
      row[2] = state
    }
    return this.conns()
  }

  connection(conn: string, request: string, state: string): StepEvent {
    const existing = this.connections.find((row) => row[0] === conn && row[1] === request)
    if (existing === undefined) {
      this.connections.push([conn, request, state])
    } else {
      existing[2] = state
    }
    return this.conns()
  }
}

const logTable = (count: number): StateTable => ({
  columns: LOG_COLUMNS,
  rows: EVENT_LOG.slice(0, count).map((entry) => [
    entry.id,
    entry.event ?? '-',
    showLineFeeds(entry.data),
  ]),
})

// ---------- メッセージ ----------

function getEvents(id: MessageId, conn: string, lastEventId?: string): Message {
  const extra = lastEventId === undefined ? [] : reconnectHeaders(lastEventId)
  return {
    id,
    from: BROWSER,
    to: SERVER,
    label:
      lastEventId === undefined ? 'GET /events' : `GET /events (Last-Event-ID: ${lastEventId})`,
    status: 'delivered',
    fields: [
      { name: 'On connection', value: conn },
      { name: 'Request line', value: 'GET /events HTTP/1.1' },
      { name: 'Host', value: HOST },
      {
        name: 'Accept',
        value: 'text/event-stream',
        highlight: true,
        description: FIELD_TEXT.accept,
      },
      { name: 'Cache-Control', value: 'no-cache', description: FIELD_TEXT.noCache },
      { name: 'Pragma', value: 'no-cache' },
      ...extra.map(([name, value]): PacketField => ({
        name,
        value,
        highlight: true,
        description: FIELD_TEXT.lastEventId,
      })),
    ],
  }
}

function streamResponse(id: MessageId, label = '200 OK (text/event-stream)'): Message {
  return {
    id,
    from: SERVER,
    to: BROWSER,
    label,
    status: 'delivered',
    fields: [
      { name: 'Status line', value: 'HTTP/1.1 200 OK' },
      {
        name: 'Content-Type',
        value: 'text/event-stream',
        highlight: true,
        description: FIELD_TEXT.eventStream,
      },
      { name: 'Cache-Control', value: 'no-store' },
      {
        name: 'Transfer-Encoding',
        value: 'chunked',
        highlight: true,
        description: FIELD_TEXT.chunked,
      },
    ],
  }
}

function chunkMessage(id: MessageId, label: string, text: string, highlight = false): Message {
  return {
    id,
    from: SERVER,
    to: BROWSER,
    label,
    status: 'delivered',
    fields: [
      {
        name: 'Chunk size',
        value: `${chunkSizeHex(text)} (${String(new TextEncoder().encode(text).length)} bytes)`,
        description: FIELD_TEXT.chunkSize,
      },
      { name: 'Lines', value: showLineFeeds(text), highlight, description: FIELD_TEXT.lines },
    ],
  }
}

const SECTIONS = {
  open: { en: 'Opening the stream', ja: 'ストリームを開く' },
  events: { en: 'Events', ja: 'イベント' },
  reconnect: { en: 'Reconnection', ja: '再接続' },
  tabs: { en: 'Six tabs', ja: '6 つのタブ' },
} satisfies Record<string, LocalizedText>

type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

function opening(browser: BrowserModel): Step[] {
  return [
    ...inSection(SECTIONS.open, [
      {
        id: 'request',
        title: { en: 'The page creates an EventSource', ja: 'ページが EventSource を作る' },
        description: {
          en: 'The page runs new EventSource("/events"). The browser sends an ordinary GET. It may add Accept: text/event-stream, and it asks caches not to answer for the server.',
          ja: 'ページが new EventSource("/events") を実行する。ブラウザーは普通の GET を送る。Accept: text/event-stream を付けてよく、キャッシュが代わりに答えないように求める。',
        },
        events: [
          send(getEvents('request', '#1')),
          browser.setReady('CONNECTING'),
          browser.connection('#1', 'GET /events (tab 1)', 'waiting'),
        ],
      },
      {
        id: 'response',
        title: { en: 'A response that does not end', ja: '終わらない応答' },
        description: {
          en: 'The server answers 200 with Content-Type: text/event-stream and no Content-Length. It sends the body in chunks and keeps the response open, so it can send an event whenever it has one. The browser checks the status and the Content-Type, sets readyState to OPEN and fires open.',
          ja: 'サーバーは Content-Type: text/event-stream の 200 で答え、Content-Length は付けない。本文をチャンクで送り、応答を開いたままにするので、イベントがあればいつでも送れる。ブラウザーは状態コードと Content-Type を確かめ、readyState を OPEN にして open を発火する。',
        },
        events: [
          send(streamResponse('response')),
          browser.setReady('OPEN'),
          ...browser.fire('open'),
          browser.connection('#1', 'GET /events (tab 1)', 'streaming'),
          set(SERVER, STREAMS, '1'),
        ],
      },
    ]),
    ...inSection(SECTIONS.events, [
      {
        id: 'event-1',
        title: { en: 'The first event', ja: '最初のイベント' },
        description: {
          en: 'Each event is a few lines ended by a blank line. retry sets the reconnection time to 5 seconds, id sets the last event ID, event sets the type (price), and data is the payload. The page’s listener for price receives it.',
          ja: 'イベントは、空行で終わるいくつかの行。retry は再接続の待ち時間を 5 秒にし、id は最後のイベント ID を、event は種類（price）を決め、data が中身。ページの price のリスナーがこれを受け取る。',
        },
        events: [
          send(chunkMessage('event-1', 'id: 1 (event: price)', CHUNK_1, true)),
          ...browser.receive(CHUNK_1),
          set(SERVER, LOG, logTable(1)),
        ],
      },
      {
        id: 'event-2',
        title: { en: 'Two data lines', ja: '2 行の data' },
        description: {
          en: 'An event can have several data lines. The browser joins them with a line feed and removes the last one, so the page gets "Q3 results\\nat 15:00".',
          ja: 'イベントは data の行をいくつも持てる。ブラウザーはそれらを改行でつなぎ、最後の改行を除くので、ページは「Q3 results\\nat 15:00」を受け取る。',
        },
        events: [
          send(chunkMessage('event-2', 'id: 2 (two data lines)', CHUNK_2, true)),
          ...browser.receive(CHUNK_2),
          set(SERVER, LOG, logTable(2)),
        ],
      },
    ]),
  ]
}

function normalSteps(): Step[] {
  const browser = new BrowserModel()
  return [
    ...opening(browser),
    ...inSection(SECTIONS.events, [
      {
        id: 'heartbeat',
        title: { en: 'A comment keeps the connection alive', ja: 'コメントで接続を保つ' },
        description: {
          en: 'Nothing has happened for 15 seconds, so the server sends a comment line (starting with :). The browser ignores it and fires nothing. The HTML Standard suggests this because some older proxies drop connections that stay idle.',
          ja: '15 秒のあいだ何も起きなかったので、サーバーはコメントの行（: で始まる）を送る。ブラウザーはそれを無視し、何も発火しない。古いプロキシには、何も流れない接続を切るものがあるので、HTML Standard がこうするよう勧めている。',
        },
        events: [
          timer(SERVER, 'heartbeat', HEARTBEAT_MS),
          send(chunkMessage('heartbeat', ': keep-alive (comment)', HEARTBEAT)),
          ...browser.receive(HEARTBEAT),
        ],
      },
      {
        id: 'event-3',
        title: { en: 'An event without a type', ja: '種類のないイベント' },
        description: {
          en: 'This event has no event field, so its type is message and it goes to the page’s onmessage handler.',
          ja: 'このイベントには event のフィールドがないので、種類は message になり、ページの onmessage に届く。',
        },
        events: [
          send(chunkMessage('event-3', 'id: 3 (message)', CHUNK_3)),
          ...browser.receive(CHUNK_3),
          set(SERVER, LOG, logTable(3)),
        ],
      },
      {
        id: 'close',
        title: { en: 'The page closes the stream', ja: 'ページがストリームを閉じる' },
        description: {
          en: 'The page calls source.close(). readyState becomes CLOSED and the browser will not reconnect. The connection cannot be reused while its response is unfinished, so the browser closes it. close() is the only way for the page to stop the reconnections.',
          ja: 'ページが source.close() を呼ぶ。readyState は CLOSED になり、ブラウザーはもう接続し直さない。応答が終わっていない接続は使い回せないので、ブラウザーはその接続を閉じる。ページが再接続を止められるのは close() だけ。',
        },
        events: [
          send({
            id: 'fin',
            from: BROWSER,
            to: SERVER,
            label: 'FIN (TCP)',
            status: 'delivered',
            fields: [{ name: 'Flags', value: 'FIN, ACK' }],
          }),
          browser.setReady('CLOSED'),
          browser.connection('#1', 'GET /events (tab 1)', 'closed'),
          set(SERVER, STREAMS, '0'),
        ],
      },
    ]),
  ]
}

function reconnectSteps(situation: 'reconnect' | 'stop204'): Step[] {
  const browser = new BrowserModel()
  const stop = situation === 'stop204'
  const end = afterEnd('OPEN', stop ? 'endOfBody' : 'networkError', RETRY_MS)
  const steps = opening(browser)
  steps.push(
    ...inSection(SECTIONS.reconnect, [
      stop
        ? {
            id: 'end',
            title: { en: 'The server ends the response', ja: 'サーバーが応答を終える' },
            description: {
              en: 'The feed has ended, so the server sends the last chunk (0) and the response is complete. But the browser does not take that as “stop”: at the end of the body it reestablishes the connection. readyState becomes CONNECTING and error fires. The connection itself stays open for reuse (RFC 9112 §9.3).',
              ja: '配信が終わったので、サーバーは最後のチャンク（0）を送り、応答は完結する。しかしブラウザーはこれを「止めて」とは受け取らない。本文が終わると接続を張り直す。readyState は CONNECTING になり、error が発火する。接続そのものは、使い回せるよう開いたまま（RFC 9112 §9.3）。',
            },
            events: [
              send(chunkMessage('end', '0 (last chunk)', '')),
              set(SERVER, FEED, 'ended'),
              set(SERVER, STREAMS, '0'),
              browser.setReady(end.readyState),
              ...browser.fire('error'),
              browser.connection('#1', 'GET /events (tab 1)', 'idle'),
            ],
          }
        : {
            id: 'drop',
            title: { en: 'The connection drops', ja: '接続が切れる' },
            description: {
              en: 'The connection closes in the middle of the stream, without the last chunk, so the response is incomplete (RFC 9112 §8). The browser reestablishes the connection: readyState becomes CONNECTING and error fires. The page does nothing; the browser reconnects on its own.',
              ja: 'ストリームの途中で、最後のチャンクなしに接続が閉じたので、応答は不完全（RFC 9112 §8）。ブラウザーは接続を張り直す。readyState は CONNECTING になり、error が発火する。ページは何もしない。ブラウザーが自分で接続し直す。',
            },
            events: [
              send({
                id: 'drop',
                from: SERVER,
                to: BROWSER,
                label: 'FIN (TCP), no last chunk',
                status: 'delivered',
                fields: [{ name: 'Flags', value: 'FIN, ACK', highlight: true }],
              }),
              set(SERVER, STREAMS, '0'),
              browser.setReady(end.readyState),
              ...browser.fire('error'),
              browser.connection('#1', 'GET /events (tab 1)', 'closed'),
            ],
          },
      {
        id: 'wait',
        title: { en: 'Waiting the reconnection time', ja: '再接続の待ち時間を待つ' },
        description: stop
          ? {
              en: 'The browser waits the reconnection time that retry: 5000 set. A browser may wait longer, for example to back off.',
              ja: 'ブラウザーは retry: 5000 で決まった再接続の待ち時間を待つ。ブラウザーは、例えば間隔を広げるために、もっと待ってもよい。',
            }
          : {
              en: 'The browser waits the reconnection time that retry: 5000 set (without retry, a default of a few seconds). A browser may wait longer, for example to back off. Meanwhile the server has produced events 3 and 4.',
              ja: 'ブラウザーは retry: 5000 で決まった再接続の待ち時間を待つ（retry がなければ、数秒の既定の値）。ブラウザーは、例えば間隔を広げるために、もっと待ってもよい。そのあいだにサーバーではイベント 3 と 4 ができている。',
            },
        events: [
          timer(BROWSER, 'retry', end.reconnectAfterMs ?? RETRY_MS),
          ...(stop ? [] : [set(SERVER, LOG, logTable(4))]),
        ],
      },
      {
        id: 'reconnect',
        title: { en: 'Reconnecting with Last-Event-ID', ja: 'Last-Event-ID を付けて接続し直す' },
        description: {
          en: `The browser sends the same GET again${stop ? ', reusing the open connection,' : ' on a new connection'} with Last-Event-ID: 2, the last event ID it received. The HTML Standard only says that the browser sends this header; what the server does with it is up to the application.`,
          ja: `ブラウザーは同じ GET を${stop ? '、開いたままの接続を使い回して、' : '新しい接続で'}送り直す。受け取った最後のイベント ID の Last-Event-ID: 2 を付ける。HTML Standard が決めているのはブラウザーがこのヘッダーを送ることだけで、サーバーがそれをどう使うかはアプリケーションが決める。`,
        },
        events: [
          send(getEvents('reconnect', stop ? '#1' : '#2', browser.parser.lastEventId)),
          set(SERVER, ID_SEEN, browser.parser.lastEventId),
          browser.connection(stop ? '#1' : '#2', 'GET /events (tab 1)', 'waiting'),
        ],
      },
    ]),
  )
  if (stop) {
    const check = checkResponse(204, null)
    steps.push(
      ...inSection(SECTIONS.reconnect, [
        {
          id: 'no-content',
          title: { en: '204 stops the reconnections', ja: '204 で再接続が止まる' },
          description: {
            en: 'The server answers 204 No Content. Any status other than 200 fails the connection: readyState becomes CLOSED, error fires, and the browser never reconnects. 204 has no content (RFC 9110 §15.3.5), and it is the way the HTML Standard gives for telling a client to stop.',
            ja: 'サーバーは 204 No Content で答える。200 以外の状態コードでは接続は失敗になる。readyState は CLOSED になり、error が発火し、ブラウザーは二度と接続し直さない。204 は内容を持たず（RFC 9110 §15.3.5）、HTML Standard がクライアントに止めさせる方法として挙げているもの。',
          },
          events: [
            send({
              id: 'no-content',
              from: SERVER,
              to: BROWSER,
              label: '204 No Content',
              status: check.kind === 'fail' ? 'rejected' : 'delivered',
              fields: [{ name: 'Status line', value: 'HTTP/1.1 204 No Content', highlight: true }],
            }),
            browser.setReady('CLOSED'),
            ...browser.fire('error'),
            browser.connection('#1', 'GET /events (tab 1)', 'idle'),
          ],
        },
      ]),
    )
    return steps
  }
  steps.push(
    ...inSection(SECTIONS.reconnect, [
      {
        id: 'resumed',
        title: { en: 'The stream is open again', ja: 'ストリームがまた開く' },
        description: {
          en: 'The server answers 200 again, and the browser fires open.',
          ja: 'サーバーはまた 200 で答え、ブラウザーは open を発火する。',
        },
        events: [
          send(streamResponse('resumed')),
          ...browser.newStream(),
          browser.setReady('OPEN'),
          ...browser.fire('open'),
          browser.connection('#2', 'GET /events (tab 1)', 'streaming'),
          set(SERVER, STREAMS, '1'),
        ],
      },
      {
        id: 'replay',
        title: {
          en: 'The server sends what the page missed',
          ja: 'サーバーが取りこぼした分を送る',
        },
        description: {
          en: 'This server keeps its recent events and sends everything after ID 2: events 3 and 4. The page misses nothing, even though the connection dropped.',
          ja: 'このサーバーは最近のイベントを保存していて、ID 2 より後のイベント 3 と 4 をすべて送る。接続が切れても、ページは何も取りこぼさない。',
        },
        events: [
          send(chunkMessage('replay', 'id: 3, id: 4 (replay)', REPLAY, true)),
          ...browser.receive(REPLAY),
        ],
      },
    ]),
  )
  return steps
}

function wrongTypeSteps(): Step[] {
  const browser = new BrowserModel()
  const check = checkResponse(200, 'text/html; charset=utf-8')
  return inSection(SECTIONS.open, [
    {
      id: 'request',
      title: { en: 'The page creates an EventSource', ja: 'ページが EventSource を作る' },
      description: {
        en: 'The page runs new EventSource("/events"), and the browser sends the GET.',
        ja: 'ページが new EventSource("/events") を実行し、ブラウザーは GET を送る。',
      },
      events: [
        send(getEvents('request', '#1')),
        browser.setReady('CONNECTING'),
        browser.connection('#1', 'GET /events (tab 1)', 'waiting'),
      ],
    },
    {
      id: 'html',
      title: { en: 'An HTML page instead of a stream', ja: 'ストリームではなく HTML のページ' },
      description: {
        en: 'The route is misconfigured, and the server answers with the application’s HTML page. The status is 200, but the Content-Type is not text/event-stream, so the browser fails the connection: readyState becomes CLOSED, error fires, and it does not try again.',
        ja: 'サーバーのルーティング（URL の割り当て）の設定を誤り、サーバーはアプリケーションの HTML のページで答える。状態コードは 200 だが、Content-Type が text/event-stream ではないので、ブラウザーは接続を失敗にする。readyState は CLOSED になり、error が発火し、試し直さない。',
      },
      events: [
        send({
          id: 'html',
          from: SERVER,
          to: BROWSER,
          label: '200 OK (text/html)',
          status: check.kind === 'fail' ? 'rejected' : 'delivered',
          fields: [
            { name: 'Status line', value: 'HTTP/1.1 200 OK' },
            { name: 'Content-Type', value: 'text/html; charset=utf-8', highlight: true },
            { name: 'Content-Length', value: '1256' },
            { name: 'Body', value: '<!doctype html>…' },
          ],
        }),
        browser.setReady('CLOSED'),
        ...browser.fire('error'),
        browser.connection('#1', 'GET /events (tab 1)', 'idle'),
      ],
    },
    {
      id: 'gave-up',
      title: { en: 'Retrying or given up?', ja: '試し直しているか、あきらめたか' },
      description: {
        en: 'In both cases the page gets an error event. In onerror it can tell them apart by readyState: 0 (CONNECTING) means the browser is retrying on its own, and 2 (CLOSED) means it has given up, so the page has to create a new EventSource if it wants one.',
        ja: 'どちらの場合も、ページには error のイベントが届く。onerror では readyState で見分けられる。0（CONNECTING）ならブラウザーが自分で試し直していて、2（CLOSED）ならあきらめたので、続けたければページが新しい EventSource を作る。',
      },
      events: [
        set(BROWSER, CONNECTIONS, {
          columns: CONNECTION_COLUMNS,
          rows: [['#1', 'GET /events (tab 1)', 'idle']],
        }),
      ],
    },
  ])
}

const TABS = [2, 3, 4, 5, 6] as const

function http1LimitSteps(): Step[] {
  const browser = new BrowserModel()
  return inSection(SECTIONS.tabs, [
    {
      id: 'tab1',
      title: { en: 'Tab 1 opens a stream', ja: 'タブ 1 がストリームを開く' },
      description: {
        en: 'The site is open in tab 1, and its page opens an EventSource over HTTP/1.1. The response never ends, so it keeps its connection busy.',
        ja: 'サイトをタブ 1 で開くと、ページは HTTP/1.1 で EventSource を開く。応答は終わらないので、その接続はずっとふさがる。',
      },
      events: [
        send(getEvents('tab1', '#1')),
        browser.setReady('CONNECTING'),
        browser.connection('#1', 'GET /events (tab 1)', 'waiting'),
      ],
    },
    {
      id: 'tab1-ok',
      title: { en: 'The stream is open', ja: 'ストリームが開く' },
      description: {
        en: 'The server answers 200 and keeps streaming.',
        ja: 'サーバーは 200 で答え、送り続ける。',
      },
      events: [
        send(streamResponse('tab1-ok', '200 OK (tab 1)')),
        browser.setReady('OPEN'),
        ...browser.fire('open'),
        browser.connection('#1', 'GET /events (tab 1)', 'streaming'),
        set(SERVER, STREAMS, '1'),
      ],
    },
    {
      id: 'tabs',
      title: { en: 'Five more tabs', ja: 'さらに 5 つのタブ' },
      description: {
        en: 'The user opens the same site in five more tabs. Each page opens its own EventSource, and each one needs its own HTTP/1.1 connection.',
        ja: '利用者は同じサイトをさらに 5 つのタブで開く。ページごとに EventSource を開き、どれも HTTP/1.1 の接続を 1 本ずつ使う。',
      },
      events: TABS.flatMap((tab) => [
        send({
          ...getEvents(`tab${String(tab)}`, `#${String(tab)}`),
          label: `GET /events (tab ${String(tab)})`,
        }),
        browser.connection(`#${String(tab)}`, `GET /events (tab ${String(tab)})`, 'waiting'),
      ]),
    },
    {
      id: 'tabs-ok',
      title: { en: 'Six streams, six connections', ja: '6 つのストリーム、6 本の接続' },
      description: {
        en: 'All six streams are open. Every connection to the server is now busy with a response that never ends.',
        ja: '6 つのストリームがすべて開く。サーバーへの接続は、どれも終わらない応答でふさがっている。',
      },
      events: [
        ...TABS.flatMap((tab) => [
          send(streamResponse(`tab${String(tab)}-ok`, `200 OK (tab ${String(tab)})`)),
          browser.connection(`#${String(tab)}`, `GET /events (tab ${String(tab)})`, 'streaming'),
        ]),
        set(SERVER, STREAMS, '6'),
      ],
    },
    {
      id: 'queued',
      title: { en: 'The next request has to wait', ja: '次の要求は待たされる' },
      description: {
        en: 'Tab 1 now fetches /api/cart. Browsers typically allow about six HTTP/1.1 connections at a time to one server, shared by all tabs. That is browser behaviour, not a standard: RFC 9112 §9.4 sets no number. All six are busy with event streams, so the request is queued, and so would images and stylesheets be. The HTML Standard warns about exactly this.',
        ja: 'タブ 1 が /api/cart を取りにいく。ブラウザーはふつう、1 つのサーバーへの HTTP/1.1 の接続を同時に約 6 本までにし、それをすべてのタブで分け合う。これはブラウザーの動きで、標準ではない。RFC 9112 §9.4 は数を決めていない。6 本ともイベントストリームでふさがっているので、要求は待たされる。画像やスタイルシートも同じ。HTML Standard もまさにこのことを注意している。',
      },
      events: [browser.connection('-', 'GET /api/cart (tab 1)', 'queued')],
    },
    {
      id: 'close-tab',
      title: { en: 'A tab is closed', ja: 'タブを 1 つ閉じる' },
      description: {
        en: 'The user closes tab 6. Its EventSource goes away, and the browser closes that connection.',
        ja: '利用者がタブ 6 を閉じる。その EventSource はなくなり、ブラウザーはその接続を閉じる。',
      },
      events: [
        send({
          id: 'close-tab',
          from: BROWSER,
          to: SERVER,
          label: 'FIN (TCP, tab 6 closed)',
          status: 'delivered',
          fields: [{ name: 'Flags', value: 'FIN, ACK' }],
        }),
        browser.connection('#6', 'GET /events (tab 6)', 'closed'),
        set(SERVER, STREAMS, '5'),
      ],
    },
    {
      id: 'cart',
      title: { en: 'Finally, the request goes out', ja: 'やっと要求が出ていく' },
      description: {
        en: 'A connection slot is free again, so the queued request goes out on a new connection.',
        ja: '接続の空きができたので、待っていた要求が新しい接続で出ていく。',
      },
      events: [
        send({
          id: 'cart',
          from: BROWSER,
          to: SERVER,
          label: 'GET /api/cart',
          status: 'delivered',
          fields: [
            { name: 'On connection', value: '#7' },
            { name: 'Request line', value: 'GET /api/cart HTTP/1.1' },
            { name: 'Host', value: HOST },
          ],
        }),
        browser.assign('GET /api/cart (tab 1)', '#7', 'waiting'),
      ],
    },
    {
      id: 'cart-ok',
      title: { en: 'The answer, and the remedies', ja: '答えと、対策' },
      description: {
        en: 'The API answers normally. The HTML Standard suggests remedies: a separate domain name per connection, letting each page turn its stream on and off, or sharing one EventSource between the pages with a shared worker. HTTP/2 also avoids the problem, because it carries many streams on one connection (see the next option).',
        ja: 'API は普通に答える。HTML Standard は対策を挙げている。接続ごとに別のドメイン名を使う、ページごとにストリームを入れたり切ったりできるようにする、共有ワーカーで 1 つの EventSource をページの間で分け合う。HTTP/2 でもこの問題は起きない。1 本の接続で多くのストリームを運ぶから（次の選択肢を参照）。',
      },
      events: [
        send({
          id: 'cart-ok',
          from: SERVER,
          to: BROWSER,
          label: '200 OK (application/json)',
          status: 'delivered',
          fields: [
            { name: 'Status line', value: 'HTTP/1.1 200 OK' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Content-Length', value: '42' },
          ],
        }),
        browser.connection('#7', 'GET /api/cart (tab 1)', 'idle'),
      ],
    },
  ])
}

function http2Steps(): Step[] {
  const browser = new BrowserModel()
  // GET の要求には本文がないので、HEADERS に END_STREAM を立てる
  const headers = (id: MessageId, stream: number, path: string): Message => ({
    id,
    from: BROWSER,
    to: SERVER,
    label: `HEADERS [stream ${String(stream)}] GET ${path}`,
    status: 'delivered',
    fields: [
      { name: 'Stream ID', value: String(stream), highlight: true },
      { name: ':method', value: 'GET' },
      { name: ':path', value: path },
      ...(path === '/events'
        ? [{ name: 'accept', value: 'text/event-stream' } satisfies PacketField]
        : []),
      { name: 'END_STREAM', value: '1' },
    ],
  })
  const ok = (id: MessageId, stream: number, label?: string): Message => ({
    id,
    from: SERVER,
    to: BROWSER,
    label: label ?? `HEADERS [stream ${String(stream)}] :status 200`,
    status: 'delivered',
    fields: [
      { name: 'Stream ID', value: String(stream) },
      { name: ':status', value: '200' },
      { name: 'content-type', value: 'text/event-stream' },
      { name: 'END_STREAM', value: '0 (the response goes on)', highlight: true },
    ],
  })
  const tabStreams = TABS.map((tab, i) => ({ tab, stream: 3 + i * 2 }))
  return inSection(SECTIONS.tabs, [
    {
      id: 'settings',
      title: { en: 'One HTTP/2 connection', ja: '1 本の HTTP/2 の接続' },
      description: {
        en: 'This time the browser and the server speak HTTP/2 over TLS (browsers use HTTP/2 only with TLS). The server announces that it allows 100 concurrent streams on the connection (RFC 9113 recommends at least 100).',
        ja: '今度は、ブラウザーとサーバーは TLS の上で HTTP/2 を話す（ブラウザーが HTTP/2 を使うのは TLS のときだけ）。サーバーは、この接続で同時に 100 本のストリームを許すと伝える（RFC 9113 は 100 以上を勧める）。',
      },
      events: [
        send({
          id: 'settings',
          from: SERVER,
          to: BROWSER,
          label: `SETTINGS (MAX_CONCURRENT_STREAMS ${String(MAX_STREAMS)})`,
          status: 'delivered',
          fields: [
            {
              name: 'SETTINGS_MAX_CONCURRENT_STREAMS',
              value: String(MAX_STREAMS),
              highlight: true,
            },
          ],
        }),
      ],
    },
    {
      id: 's1',
      title: { en: 'Tab 1 opens a stream', ja: 'タブ 1 がストリームを開く' },
      description: {
        en: 'The EventSource request becomes HTTP/2 stream 1. Client streams have odd numbers (RFC 9113 §5.1.1).',
        ja: 'EventSource の要求は HTTP/2 のストリーム 1 になる。クライアントのストリームは奇数（RFC 9113 §5.1.1）。',
      },
      events: [
        send(headers('s1', 1, '/events')),
        browser.setReady('CONNECTING'),
        browser.connection('#1 s1', 'GET /events (tab 1)', 'waiting'),
      ],
    },
    {
      id: 's1-ok',
      title: { en: 'A stream that stays open', ja: '開いたままのストリーム' },
      description: {
        en: 'The response headers carry no END_STREAM, so the response goes on and the stream does not close (from the browser’s side it is half-closed (local), since its request has ended), and events arrive in DATA frames. HTTP/2 has no chunked transfer coding and no Transfer-Encoding header (RFC 9113 §8.1, §8.2.2).',
        ja: '応答のヘッダーに END_STREAM がないので、応答は続き、ストリームは閉じない（ブラウザーの側から見ると、要求は終わっているので half-closed (local)）。イベントは DATA のフレームで届く。HTTP/2 には chunked の転送コーディングも Transfer-Encoding のヘッダーもない（RFC 9113 §8.1、§8.2.2）。',
      },
      events: [
        send(ok('s1-ok', 1)),
        send({
          id: 's1-data',
          from: SERVER,
          to: BROWSER,
          label: 'DATA [stream 1] id: 1',
          status: 'delivered',
          fields: [
            { name: 'Stream ID', value: '1' },
            { name: 'Lines', value: showLineFeeds(CHUNK_1), description: FIELD_TEXT.lines },
          ],
        }),
        browser.setReady('OPEN'),
        ...browser.fire('open'),
        ...browser.receive(CHUNK_1),
        browser.connection('#1 s1', 'GET /events (tab 1)', 'streaming'),
        set(SERVER, STREAMS, '1'),
      ],
    },
    {
      id: 'tabs',
      title: { en: 'Five more tabs, the same connection', ja: 'さらに 5 つのタブ、同じ接続' },
      description: {
        en: 'The other tabs’ EventSources become streams 3 to 11 on the same connection. No new connection is needed.',
        ja: 'ほかのタブの EventSource は、同じ接続のストリーム 3〜11 になる。新しい接続はいらない。',
      },
      events: tabStreams.flatMap(({ tab, stream }) => [
        send(headers(`s${String(stream)}`, stream, '/events')),
        browser.connection(`#1 s${String(stream)}`, `GET /events (tab ${String(tab)})`, 'waiting'),
      ]),
    },
    {
      id: 'tabs-ok',
      title: { en: 'Six streams, one connection', ja: '6 本のストリーム、1 本の接続' },
      description: {
        en: `All six event streams are open, using 6 of the ${String(MAX_STREAMS)} streams the server allows.`,
        ja: `6 本のイベントストリームがすべて開く。サーバーが許す ${String(MAX_STREAMS)} 本のうち 6 本を使っている。`,
      },
      events: [
        ...tabStreams.flatMap(({ tab, stream }) => [
          send(ok(`s${String(stream)}-ok`, stream)),
          browser.connection(
            `#1 s${String(stream)}`,
            `GET /events (tab ${String(tab)})`,
            'streaming',
          ),
        ]),
        set(SERVER, STREAMS, '6'),
      ],
    },
    {
      id: 'cart',
      title: { en: 'The next request goes out at once', ja: '次の要求はすぐに出ていく' },
      description: {
        en: 'Tab 1 fetches /api/cart as stream 13 on the same connection. Nothing waits.',
        ja: 'タブ 1 は /api/cart を、同じ接続のストリーム 13 として取りにいく。何も待たない。',
      },
      events: [
        send(headers('s13', 13, '/api/cart')),
        browser.connection('#1 s13', 'GET /api/cart (tab 1)', 'waiting'),
      ],
    },
    {
      id: 'cart-ok',
      title: {
        en: 'Frames of different streams interleave',
        ja: '別のストリームのフレームが混ざって流れる',
      },
      description: {
        en: 'The API response on stream 13 ends with END_STREAM, while the next event arrives on stream 1, which does not close. Frames of different streams share the connection (see the HTTP/2 theme).',
        ja: 'ストリーム 13 の API の応答は END_STREAM で終わり、そのあいだにも次のイベントが、閉じないストリーム 1 で届く。別のストリームのフレームが 1 本の接続を分け合う（HTTP/2 のテーマを参照）。',
      },
      events: [
        send({
          id: 's13-ok',
          from: SERVER,
          to: BROWSER,
          label: 'HEADERS+DATA [stream 13] 200',
          status: 'delivered',
          fields: [
            { name: 'Stream ID', value: '13' },
            { name: ':status', value: '200' },
            { name: 'content-type', value: 'application/json' },
            { name: 'END_STREAM', value: '1' },
          ],
        }),
        send({
          id: 's1-data-2',
          from: SERVER,
          to: BROWSER,
          label: 'DATA [stream 1] id: 2',
          status: 'delivered',
          fields: [
            { name: 'Stream ID', value: '1' },
            { name: 'Lines', value: showLineFeeds(CHUNK_2), description: FIELD_TEXT.lines },
          ],
        }),
        ...browser.receive(CHUNK_2),
        browser.connection('#1 s13', 'GET /api/cart (tab 1)', 'closed'),
      ],
    },
  ])
}

function buildSteps({ situation }: SseOptions): readonly Step[] {
  switch (situation) {
    case 'normal':
      return normalSteps()
    case 'reconnect':
    case 'stop204':
      return reconnectSteps(situation)
    case 'wrongType':
      return wrongTypeSteps()
    case 'http1Limit':
      return http1LimitSteps()
    case 'http2':
      return http2Steps()
  }
}

export const sseScenario: Scenario<SseOptions> = {
  id: 'server-sent-events',
  title: {
    en: 'Server-Sent Events: a response that never ends',
    ja: 'Server-Sent Events: 終わらない応答と自動の再接続',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        { value: 'normal', label: { en: 'Everything works', ja: 'すべて正常' } },
        { value: 'reconnect', label: { en: 'The connection drops', ja: '接続が切れる' } },
        {
          value: 'stop204',
          label: { en: 'The server says stop (204)', ja: 'サーバーが止める（204）' },
        },
        { value: 'wrongType', label: { en: 'Wrong Content-Type', ja: 'Content-Type の誤り' } },
        {
          value: 'http1Limit',
          label: { en: '6 tabs over HTTP/1.1', ja: 'HTTP/1.1 で 6 つのタブ' },
        },
        { value: 'http2', label: { en: '6 tabs over HTTP/2', ja: 'HTTP/2 で 6 つのタブ' } },
      ],
      defaultValue: 'normal',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
