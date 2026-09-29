/**
 * リプレイの窓（ホワイトペーパー §5.4.6 は RFC 6479 のような窓を使うとだけ書き、大きさは決めていない）。
 * Linux の drivers/net/wireguard は 8192 ビットのビットマップで、64 ビットの環境では窓は 8192 − 64 = 8128。
 * 確かめるのは tag を確かめた後（偽のパケットで窓を動かされないように）。
 *
 * ここでは次のように受け入れる: カウンターが「これまでの最大 − 窓の大きさ」以上で、まだ見ていないもの
 */

export const REPLAY_WINDOW = 8128

export interface ReplayState {
  /** これまでに受け入れた最大のカウンター。まだなければ -1 */
  readonly greatest: number
  /** 窓の中で受け入れたカウンター */
  readonly seen: readonly number[]
}

export const INITIAL_REPLAY: ReplayState = { greatest: -1, seen: [] }

export type ReplayResult =
  | { readonly accepted: true; readonly next: ReplayState; readonly reason: 'new' | 'late' }
  | { readonly accepted: false; readonly reason: 'duplicate' | 'tooOld' }

export function checkCounter(
  state: ReplayState,
  counter: number,
  window: number = REPLAY_WINDOW,
): ReplayResult {
  if (counter > state.greatest) {
    const greatest = counter
    const seen = [...state.seen, counter].filter((c) => c >= greatest - window)
    return { accepted: true, reason: 'new', next: { greatest, seen } }
  }
  if (counter < state.greatest - window) {
    return { accepted: false, reason: 'tooOld' }
  }
  if (state.seen.includes(counter)) {
    return { accepted: false, reason: 'duplicate' }
  }
  return {
    accepted: true,
    reason: 'late',
    next: { greatest: state.greatest, seen: [...state.seen, counter] },
  }
}

/** 表に出す要約（例: `greatest 7, seen 0–7`） */
export function describeReplay(state: ReplayState): string {
  if (state.greatest < 0) {
    return '-'
  }
  const sorted = [...state.seen].sort((a, b) => a - b)
  const contiguous = sorted.length > 0 && sorted.every((value, i) => value === (sorted[0] ?? 0) + i)
  const seen = contiguous
    ? `${String(sorted[0])}–${String(sorted[sorted.length - 1])}`
    : sorted.join(', ')
  return `greatest ${String(state.greatest)}, seen ${seen}`
}
