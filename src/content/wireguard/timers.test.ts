// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  newHandshakeAt,
  passiveKeepaliveAt,
  persistentKeepaliveAt,
  rekeyOnReceive,
  rekeyOnSend,
  retryTimes,
  usable,
  zeroAt,
} from './timers'

describe('WireGuard のタイマー', () => {
  it('始めた側だけが、120 秒以上たった鍵の組で送るときに鍵を更新する', () => {
    expect(rekeyOnSend({ createdAt: 0, initiator: true }, 119)).toBe(false)
    expect(rekeyOnSend({ createdAt: 0, initiator: true }, 120)).toBe(true)
    expect(rekeyOnSend({ createdAt: 0, initiator: false }, 150)).toBe(false)
  })

  it('受け取る側では 165 秒', () => {
    expect(rekeyOnReceive({ createdAt: 0, initiator: true }, 164)).toBe(false)
    expect(rekeyOnReceive({ createdAt: 0, initiator: true }, 165)).toBe(true)
  })

  it('180 秒で使えなくなり、540 秒で鍵を消す', () => {
    expect(usable({ createdAt: 0, initiator: true }, 179)).toBe(true)
    expect(usable({ createdAt: 0, initiator: true }, 180)).toBe(false)
    expect(zeroAt(0)).toBe(540)
  })

  it('キープアライブと新しいハンドシェイクの時刻', () => {
    expect(passiveKeepaliveAt(0)).toBe(10)
    expect(newHandshakeAt(45)).toBe(60)
    expect(
      [50, 75, 100].map((t, i, all) => (i === 0 ? t : persistentKeepaliveAt(all[i - 1] ?? 0, 25))),
    ).toEqual([50, 75, 100])
  })

  it('送り直しは 5 秒ごとで、90 秒であきらめる', () => {
    const times = retryTimes(0)
    expect(times[0]).toBe(5)
    expect(times[times.length - 1]).toBe(85)
    expect(times).toHaveLength(17)
  })
})
