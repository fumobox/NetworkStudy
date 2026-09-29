// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { feed, INITIAL_STREAM_STATE, parseEventStream, serializeEvent } from './eventStream'

const data = (text: string) => parseEventStream(text).events.map((e) => e.data)

describe('イベントストリームの解析（HTML Standard「Interpreting an event stream」の例）', () => {
  it('data の行は LF でつなぎ、最後の LF を除く', () => {
    expect(data('data: YHOO\ndata: +2\ndata: 10\n\n')).toEqual(['YHOO\n+2\n10'])
  })

  it('4 つのブロック: コメント、id: 1、値のない id で ID が空に戻る、先頭の空白は 1 つだけ除く', () => {
    const text =
      ': test stream\n\ndata: first event\nid: 1\n\ndata:second event\nid\n\ndata:  third event\n\n'
    const { events, state } = parseEventStream(text)
    expect(events).toEqual([
      { type: 'message', data: 'first event', lastEventId: '1' },
      { type: 'message', data: 'second event', lastEventId: '' },
      { type: 'message', data: ' third event', lastEventId: '' },
    ])
    expect(state.lastEventId).toBe('')
  })

  it('最後のブロックは空行で終わらなければ出さない', () => {
    expect(data('data:  third event\n')).toEqual([])
  })

  it('空のデータの 2 つのイベントと、捨てられる最後のブロック', () => {
    expect(data('data\n\ndata\ndata\n\ndata:')).toEqual(['', '\n'])
  })

  it('コロンの後の空白はあってもなくても同じ', () => {
    expect(data('data:test\n\ndata: test\n\n')).toEqual(['test', 'test'])
  })
})

describe('解析の細かい規則', () => {
  it('行の終わりは CRLF・LF・CR のどれでもよく、chunk の境目で分かれた CRLF も 1 つの行の終わり', () => {
    expect(data('data: a\r\n\r\ndata: b\r\rdata: c\n\n')).toEqual(['a', 'b', 'c'])
    const first = feed(INITIAL_STREAM_STATE, 'data: a\r')
    const second = feed(first.state, '\n\r\n')
    expect([...first.events, ...second.events].map((e) => e.data)).toEqual(['a'])
  })

  it('先頭の BOM を除く', () => {
    expect(data('﻿data: x\n\n')).toEqual(['x'])
  })

  it('event で種類を決め、なければ message', () => {
    expect(
      parseEventStream('event: add\ndata: 73857293\n\ndata: y\n\n').events.map((e) => e.type),
    ).toEqual(['add', 'message'])
  })

  it('NULL を含む id と、数字でない retry は無視する', () => {
    const { state } = parseEventStream('id: 7\n\nid: a\u0000b\nretry: 5s\nretry: -1\n\n')
    expect(state.lastEventId).toBe('7')
    expect(state.reconnectionTime).toBeNull()
    expect(parseEventStream('retry: 5000\n').state.reconnectionTime).toBe(5000)
  })

  it('名前は大文字小文字を区別し、知らないフィールドは無視する', () => {
    expect(data('Data: x\nfoo: y\ndata: z\n\n')).toEqual(['z'])
  })

  it('データが空でも、ID は最後のイベント ID になる', () => {
    const { events, state } = parseEventStream('id: 5\n\n')
    expect(events).toEqual([])
    expect(state.lastEventId).toBe('5')
  })

  it('組み立てた行を解析すると、もとのイベントに戻る', () => {
    const text = serializeEvent({
      id: '2',
      event: 'news',
      data: 'Q3 results\nat 15:00',
      retry: 5000,
    })
    expect(text).toBe('retry: 5000\nid: 2\nevent: news\ndata: Q3 results\ndata: at 15:00\n\n')
    const { events, state } = parseEventStream(text)
    expect(events).toEqual([{ type: 'news', data: 'Q3 results\nat 15:00', lastEventId: '2' }])
    expect(state.reconnectionTime).toBe(5000)
  })
})
