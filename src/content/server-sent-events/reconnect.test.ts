// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chunkSizeHex } from './chunked'
import { afterEnd, checkResponse, mimeEssence, reconnectHeaders } from './reconnect'

describe('EventSource の接続の規則（HTML Standard「The EventSource interface」）', () => {
  it('200 と text/event-stream なら開く。種類は大文字小文字とパラメーターを無視して比べる', () => {
    for (const type of [
      'text/event-stream',
      'Text/Event-Stream',
      'text/event-stream; charset=utf-8',
    ]) {
      expect(checkResponse(200, type)).toEqual({ kind: 'announce' })
    }
    expect(mimeEssence(null)).toBeNull()
  })

  it('200 でなければ失敗にする（204 で再接続を止められる）', () => {
    for (const status of [204, 404, 500]) {
      expect(checkResponse(status, 'text/event-stream')).toEqual({ kind: 'fail', reason: 'status' })
    }
  })

  it('Content-Type が違えば、200 でも失敗にする', () => {
    expect(checkResponse(200, 'text/html')).toEqual({ kind: 'fail', reason: 'contentType' })
    expect(checkResponse(200, null)).toEqual({ kind: 'fail', reason: 'contentType' })
  })

  it('本文の終わりとネットワークエラーでは接続し直し、中断では失敗にする。close() のあとは何もしない', () => {
    expect(afterEnd('OPEN', 'endOfBody', 5000)).toEqual({
      readyState: 'CONNECTING',
      fire: 'error',
      reconnectAfterMs: 5000,
    })
    expect(afterEnd('OPEN', 'networkError', 5000).readyState).toBe('CONNECTING')
    expect(afterEnd('OPEN', 'abortedNetworkError', 5000)).toEqual({
      readyState: 'CLOSED',
      fire: 'error',
      reconnectAfterMs: null,
    })
    expect(afterEnd('CLOSED', 'endOfBody', 5000)).toEqual({
      readyState: 'CLOSED',
      fire: null,
      reconnectAfterMs: null,
    })
  })

  it('最後のイベント ID が空でなければ Last-Event-ID を付ける', () => {
    expect(reconnectHeaders('2')).toEqual([['Last-Event-ID', '2']])
    expect(reconnectHeaders('')).toEqual([])
  })
})

describe('chunked の chunk-size（RFC 9112 §7.1）', () => {
  it('UTF-8 のバイト数を 16 進で', () => {
    expect(chunkSizeHex('a')).toBe('1')
    expect(chunkSizeHex('0123456789abcdef')).toBe('10')
    expect(chunkSizeHex('é')).toBe('2')
  })
})
