/**
 * text/event-stream の解析と組み立て
 *
 * HTML Standard（WHATWG）「Interpreting an event stream」（#event-stream-interpretation）の手順どおり:
 * - 行の終わりは CRLF、CR の後でない LF、LF の前でない CR。UTF-8 のデコードで先頭の BOM を 1 つ除く
 * - 空行でイベントを出す（dispatch）。':' で始まる行は無視する（コメント）
 * - 最初の ':' より前がフィールド名、後が値。値の先頭の空白は 1 つだけ除く。':' のない行は、行全体が名前で値は空
 * - event は種類のバッファーに、data は値と LF をデータのバッファーに足す。id は NULL を含まなければ ID のバッファーに。
 *   retry は ASCII の数字だけなら再接続の待ち時間にする。ほかは無視。名前は大文字小文字を区別する
 * - イベントを出すとき: まず ID のバッファーを最後のイベント ID にする（バッファーは消さない）。データが空なら何も出さずに
 *   データと種類を空に戻す。最後の LF を 1 つ除き、種類が空なら message にする
 * - ストリームの終わりに、空行で終わっていないイベントは捨てる
 */

export interface DispatchedEvent {
  readonly type: string
  readonly data: string
  readonly lastEventId: string
}

export interface StreamState {
  readonly data: string
  readonly eventType: string
  /** ID のバッファー（イベントを出しても消えない） */
  readonly lastEventIdBuffer: string
  /** EventSource の最後のイベント ID（再接続の Last-Event-ID に使う） */
  readonly lastEventId: string
  /** retry で決まった再接続の待ち時間。null ならブラウザーの既定 */
  readonly reconnectionTime: number | null
  /** まだ行の終わりが来ていない文字 */
  readonly partial: string
  /** 直前の chunk が CR で終わった（次の chunk の先頭の LF は、その CR と組になる） */
  readonly afterCR: boolean
  /** 先頭の BOM を調べ終えた */
  readonly started: boolean
}

export const INITIAL_STREAM_STATE: StreamState = {
  data: '',
  eventType: '',
  lastEventIdBuffer: '',
  lastEventId: '',
  reconnectionTime: null,
  partial: '',
  afterCR: false,
  started: false,
}

interface Mutable {
  data: string
  eventType: string
  lastEventIdBuffer: string
  lastEventId: string
  reconnectionTime: number | null
}

function processLine(s: Mutable, line: string, events: DispatchedEvent[]) {
  if (line === '') {
    s.lastEventId = s.lastEventIdBuffer
    if (s.data === '') {
      s.eventType = ''
      return
    }
    const data = s.data.endsWith('\n') ? s.data.slice(0, -1) : s.data
    events.push({
      type: s.eventType === '' ? 'message' : s.eventType,
      data,
      lastEventId: s.lastEventId,
    })
    s.data = ''
    s.eventType = ''
    return
  }
  if (line.startsWith(':')) {
    return
  }
  const colon = line.indexOf(':')
  const field = colon === -1 ? line : line.slice(0, colon)
  let value = colon === -1 ? '' : line.slice(colon + 1)
  if (value.startsWith(' ')) {
    value = value.slice(1)
  }
  switch (field) {
    case 'event':
      s.eventType = value
      break
    case 'data':
      s.data += `${value}\n`
      break
    case 'id':
      if (!value.includes('\u0000')) {
        s.lastEventIdBuffer = value
      }
      break
    case 'retry':
      // 「ASCII の数字だけ」を、ここでは 1 桁以上の数字と読む
      if (/^[0-9]+$/.test(value)) {
        s.reconnectionTime = Number.parseInt(value, 10)
      }
      break
    default:
      break
  }
}

/** 届いた文字列を順に解析する。行の途中で切れた部分は次の呼び出しに持ち越す */
export function feed(
  state: StreamState,
  chunk: string,
): { state: StreamState; events: DispatchedEvent[] } {
  const s: Mutable = {
    data: state.data,
    eventType: state.eventType,
    lastEventIdBuffer: state.lastEventIdBuffer,
    lastEventId: state.lastEventId,
    reconnectionTime: state.reconnectionTime,
  }
  const events: DispatchedEvent[] = []
  let text = chunk
  let started = state.started
  if (!started && text.length > 0) {
    if (text.startsWith('\uFEFF')) {
      text = text.slice(1)
    }
    started = true
  }
  if (text.length === 0) {
    // 空の chunk では何も変えない（CR の直後の LF を待っている状態も持ち越す）
    return { state: { ...state, started }, events: [] }
  }
  if (state.afterCR && text.startsWith('\n')) {
    text = text.slice(1)
  }
  let afterCR = false
  let line = state.partial
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    if (c === '\r') {
      processLine(s, line, events)
      line = ''
      if (text[i + 1] === '\n') {
        i++
      } else if (i === text.length - 1) {
        afterCR = true
      }
    } else if (c === '\n') {
      processLine(s, line, events)
      line = ''
    } else {
      line += c
    }
  }
  return { state: { ...s, partial: line, afterCR, started }, events }
}

/** ストリーム全体を解析する（最後の空行のないイベントは捨てる） */
export function parseEventStream(text: string): { state: StreamState; events: DispatchedEvent[] } {
  const result = feed(INITIAL_STREAM_STATE, text)
  return { state: { ...result.state, data: '', eventType: '', partial: '' }, events: result.events }
}

export interface EventSpec {
  readonly id?: string
  readonly event?: string
  readonly data: string
  readonly retry?: number
}

/** 1 つのイベントの行（data の LF ごとに data: の行を分け、最後に空行） */
export function serializeEvent(spec: EventSpec): string {
  return [
    ...(spec.retry === undefined ? [] : [`retry: ${String(spec.retry)}`]),
    ...(spec.id === undefined ? [] : [`id: ${spec.id}`]),
    ...(spec.event === undefined ? [] : [`event: ${spec.event}`]),
    ...spec.data.split('\n').map((line) => `data: ${line}`),
    '',
    '',
  ].join('\n')
}
