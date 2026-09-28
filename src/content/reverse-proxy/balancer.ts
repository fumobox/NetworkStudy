/**
 * バックエンドの選び方とヘルスチェック。HTTP の標準ではなく、製品の設定で決まる（RFC 9110 §3.7 は、ゲートウェイが
 * 負荷分散に使われることに触れるだけ）。ここでは例えば nginx や HAProxy の既定と同じラウンドロビンと、
 * HAProxy の fall / rise と同じ考え方（続けて fall 回失敗したら外し、続けて rise 回成功したら戻す）を使う。
 * 失敗の種類と状態コードの対応は RFC 9209 §2.3（Proxy-Status の error の種類と、推奨する状態コード）
 */

export type Health = 'unknown' | 'up' | 'down'

export interface PoolEntry {
  readonly id: string
  readonly health: Health
}

export interface BackendPick {
  readonly backend: string
  /** 次に選び始める位置 */
  readonly cursor: number
}

/** cursor の位置から順に、down でない最初のバックエンドを選ぶ。すべて down なら null（503 を返す） */
export function pickRoundRobin(pool: readonly PoolEntry[], cursor: number): BackendPick | null {
  for (let i = 0; i < pool.length; i++) {
    const index = (cursor + i) % pool.length
    const entry = pool[index]
    if (entry !== undefined && entry.health !== 'down') {
      return { backend: entry.id, cursor: (index + 1) % pool.length }
    }
  }
  return null
}

/** Cookie で決まったバックエンドが使えればそれを、使えなければラウンドロビンで選ぶ */
export function pickSticky(
  pool: readonly PoolEntry[],
  pinned: string | undefined,
  cursor: number,
): (BackendPick & { readonly byCookie: boolean }) | null {
  const entry = pool.find((candidate) => candidate.id === pinned)
  if (entry !== undefined && entry.health !== 'down') {
    return { backend: entry.id, cursor, byCookie: true }
  }
  const pick = pickRoundRobin(pool, cursor)
  return pick === null ? null : { ...pick, byCookie: false }
}

export interface HealthState {
  readonly health: Health
  /** 続けて失敗した回数 */
  readonly fails: number
  /** 続けて成功した回数 */
  readonly passes: number
}

export interface Thresholds {
  readonly rise: number
  readonly fall: number
}

export function nextHealth(
  state: HealthState,
  ok: boolean,
  { rise, fall }: Thresholds,
): HealthState {
  if (ok) {
    const passes = state.passes + 1
    const recovered = state.health !== 'down' || passes >= rise
    return { health: recovered ? 'up' : 'down', fails: 0, passes }
  }
  const fails = state.fails + 1
  return { health: fails >= fall ? 'down' : state.health, fails, passes: 0 }
}

/** RFC 9209 §2.3 の error の種類と、推奨する状態コード */
export const ERROR_STATUS = {
  connection_refused: 502,
  connection_terminated: 502,
  destination_unavailable: 503,
  connection_timeout: 504,
  http_response_timeout: 504,
} as const
export type ProxyError = keyof typeof ERROR_STATUS
