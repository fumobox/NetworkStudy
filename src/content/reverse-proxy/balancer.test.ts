// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ERROR_STATUS, nextHealth, pickRoundRobin, pickSticky, type PoolEntry } from './balancer'

const up: PoolEntry[] = [
  { id: 'A', health: 'up' },
  { id: 'B', health: 'up' },
]
const bDown: PoolEntry[] = [
  { id: 'A', health: 'up' },
  { id: 'B', health: 'down' },
]

describe('ラウンドロビン', () => {
  it('A、B、A の順に選ぶ', () => {
    const picks: string[] = []
    let cursor = 0
    for (let i = 0; i < 3; i++) {
      const pick = pickRoundRobin(up, cursor)
      picks.push(pick?.backend ?? '-')
      cursor = pick?.cursor ?? cursor
    }
    expect(picks).toEqual(['A', 'B', 'A'])
  })

  it('down のバックエンドは飛ばし、すべて down なら null', () => {
    expect(pickRoundRobin(bDown, 1)?.backend).toBe('A')
    expect(
      pickRoundRobin(
        [
          { id: 'A', health: 'down' },
          { id: 'B', health: 'down' },
        ],
        0,
      ),
    ).toBeNull()
  })

  it('Cookie で決まったバックエンドを選び、down ならラウンドロビンに戻る', () => {
    expect(pickSticky(up, 'A', 1)).toEqual({ backend: 'A', cursor: 1, byCookie: true })
    expect(pickSticky(bDown, 'B', 1)).toEqual({ backend: 'A', cursor: 1, byCookie: false })
  })
})

describe('ヘルスチェック', () => {
  const thresholds = { rise: 2, fall: 2 }

  it('続けて 2 回失敗したら down、続けて 2 回成功したら up に戻る', () => {
    let state = nextHealth({ health: 'up', fails: 0, passes: 0 }, false, thresholds)
    expect(state).toEqual({ health: 'up', fails: 1, passes: 0 })
    state = nextHealth(state, false, thresholds)
    expect(state.health).toBe('down')
    state = nextHealth(state, true, thresholds)
    expect(state.health).toBe('down')
    state = nextHealth(state, true, thresholds)
    expect(state.health).toBe('up')
  })

  it('最初の成功で unknown から up になる', () => {
    expect(nextHealth({ health: 'unknown', fails: 0, passes: 0 }, true, thresholds).health).toBe(
      'up',
    )
  })
})

describe('Proxy-Status の error と状態コード（RFC 9209 §2.3）', () => {
  it('切れたら 502、使えるバックエンドがなければ 503、応答が遅ければ 504', () => {
    expect(ERROR_STATUS).toEqual({
      connection_refused: 502,
      connection_terminated: 502,
      destination_unavailable: 503,
      connection_timeout: 504,
      http_response_timeout: 504,
    })
  })
})
