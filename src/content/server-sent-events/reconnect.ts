/**
 * EventSource の接続の規則（HTML Standard「The EventSource interface」#the-eventsource-interface、「Processing model」
 * #sse-processing-model）
 *
 * - 応答が届いたら: 中断されたネットワークエラーなら fail。ほかのネットワークエラーなら reestablish。状態コードが 200 でないか、
 *   Content-Type が text/event-stream でなければ fail。それ以外は announce（OPEN、open を発火）
 * - 本文が終わったら（ネットワークエラーでなければ）reestablish
 * - reestablish: CONNECTING にして error を発火し、再接続の待ち時間のあとで接続し直す。最後のイベント ID が空でなければ
 *   Last-Event-ID を付ける。fail: CLOSED にして error を発火し、二度と接続し直さない
 * - Content-Type の比べ方は、このページでは MIME の本質（type/subtype。大文字小文字を区別しない。RFC 9110 §8.3.1）で比べる
 */

export type ReadyState = 'CONNECTING' | 'OPEN' | 'CLOSED'

/** Content-Type の type/subtype を小文字で。パラメーターは除く */
export function mimeEssence(contentType: string | null): string | null {
  if (contentType === null) {
    return null
  }
  const [essence = ''] = contentType.split(';')
  const trimmed = essence.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

export type ResponseCheck =
  | { readonly kind: 'announce' }
  | { readonly kind: 'fail'; readonly reason: 'status' | 'contentType' }

export function checkResponse(status: number, contentType: string | null): ResponseCheck {
  if (status !== 200) {
    return { kind: 'fail', reason: 'status' }
  }
  if (mimeEssence(contentType) !== 'text/event-stream') {
    return { kind: 'fail', reason: 'contentType' }
  }
  return { kind: 'announce' }
}

export type ConnectionEnd = 'endOfBody' | 'networkError' | 'abortedNetworkError'

export interface AfterEnd {
  readonly readyState: ReadyState
  readonly fire: 'error' | null
  /** 接続し直すまでの待ち時間。接続し直さなければ null */
  readonly reconnectAfterMs: number | null
}

/** 接続が終わったあとの状態（close() で CLOSED にしたあとは何もしない） */
export function afterEnd(
  ready: ReadyState,
  end: ConnectionEnd,
  reconnectionTimeMs: number,
): AfterEnd {
  if (ready === 'CLOSED') {
    return { readyState: 'CLOSED', fire: null, reconnectAfterMs: null }
  }
  if (end === 'abortedNetworkError') {
    return { readyState: 'CLOSED', fire: 'error', reconnectAfterMs: null }
  }
  return { readyState: 'CONNECTING', fire: 'error', reconnectAfterMs: reconnectionTimeMs }
}

/** 接続し直す要求に足すヘッダー（最後のイベント ID が空なら何も足さない） */
export function reconnectHeaders(lastEventId: string): readonly (readonly [string, string])[] {
  return lastEventId === '' ? [] : [['Last-Event-ID', lastEventId]]
}
