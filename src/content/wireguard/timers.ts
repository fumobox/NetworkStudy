/**
 * WireGuard のタイマー（ホワイトペーパー §6、Linux の drivers/net/wireguard/messages.h と timers.c。値は一致する）。
 * - 鍵の更新: 今の鍵の組を始めた側が、120 秒以上たった鍵の組でデータを送るときに、新しいハンドシェイクを始める。
 *   120 秒になった瞬間に何かが起きるわけではない。受け取る側では 180 − 10 − 5 = 165 秒で 1 度だけ
 * - 180 秒たった鍵の組では送りも受け取りもしない。540 秒（3 × 180）で鍵を消す
 * - ハンドシェイクに答えがなければ、5 秒（と 0〜333 ms のゆらぎ）ごとに、新しい一時的な鍵で送り直し、90 秒であきらめる
 * - データを受け取り、10 秒のあいだ何も送らなければ、キープアライブ（中身のないデータ）を送る
 * - データを送り、15 秒のあいだ何も受け取らなければ、新しいハンドシェイクを始める
 * - PersistentKeepalive（wg(8)。既定では使わない）: 最後に認証済みのパケットを送るか受け取ってから、その秒数ごとにキープアライブを送る
 */

export const REKEY_AFTER_TIME = 120
export const REJECT_AFTER_TIME = 180
export const REKEY_ATTEMPT_TIME = 90
export const REKEY_TIMEOUT = 5
export const KEEPALIVE_TIMEOUT = 10
export const REKEY_AFTER_MESSAGES = 2 ** 60

export interface KeypairAge {
  readonly createdAt: number
  /** この鍵の組のハンドシェイクを自分が始めたか */
  readonly initiator: boolean
}

/** データを送るときに、新しいハンドシェイクを始めるか */
export function rekeyOnSend(keypair: KeypairAge, now: number): boolean {
  return keypair.initiator && now - keypair.createdAt >= REKEY_AFTER_TIME
}

/** データを受け取ったときに、新しいハンドシェイクを始めるか（1 度だけ） */
export function rekeyOnReceive(keypair: KeypairAge, now: number): boolean {
  return (
    keypair.initiator &&
    now - keypair.createdAt >= REJECT_AFTER_TIME - KEEPALIVE_TIMEOUT - REKEY_TIMEOUT
  )
}

/** この鍵の組でまだ送れるか */
export function usable(keypair: KeypairAge, now: number): boolean {
  return now - keypair.createdAt < REJECT_AFTER_TIME
}

/** 鍵を消す時刻 */
export const zeroAt = (createdAt: number) => createdAt + 3 * REJECT_AFTER_TIME

/** データを受け取った後、何も送らなければキープアライブを送る時刻 */
export const passiveKeepaliveAt = (lastDataReceived: number) => lastDataReceived + KEEPALIVE_TIMEOUT

/** データを送った後、何も受け取らなければ新しいハンドシェイクを始める時刻 */
export const newHandshakeAt = (lastDataSent: number) =>
  lastDataSent + KEEPALIVE_TIMEOUT + REKEY_TIMEOUT

/** PersistentKeepalive の次の時刻 */
export const persistentKeepaliveAt = (lastAuthenticated: number, interval: number) =>
  lastAuthenticated + interval

/** ハンドシェイクを送り直す時刻（ゆらぎを除く）。90 秒であきらめる */
export function retryTimes(start: number): readonly number[] {
  const times: number[] = []
  for (let t = start + REKEY_TIMEOUT; t - start < REKEY_ATTEMPT_TIME; t += REKEY_TIMEOUT) {
    times.push(t)
  }
  return times
}
