/**
 * BGP のセッションの時間（RFC 4271 §4.2、§4.4、§10）。
 * - Hold Time は、自分の設定と相手の OPEN の値の小さい方。0 か 3 秒以上でなければならない
 * - KEEPALIVE は Hold Time の 3 分の 1 ごとが目安（既定の Hold Time は 90 秒）。Hold Time が 0 なら送らない
 */

export const DEFAULT_HOLD_TIME = 90

export function negotiateHoldTime(mine: number, theirs: number): number {
  for (const value of [mine, theirs]) {
    if (value !== 0 && value < 3) {
      throw new Error(`Hold Time は 0 か 3 秒以上: ${String(value)}`)
    }
  }
  return Math.min(mine, theirs)
}

export const keepaliveInterval = (holdTime: number): number => Math.floor(holdTime / 3)
