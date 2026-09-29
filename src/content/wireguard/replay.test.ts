// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  checkCounter,
  describeReplay,
  INITIAL_REPLAY,
  REPLAY_WINDOW,
  type ReplayState,
} from './replay'

function feed(counters: readonly number[], window?: number): ReplayState {
  return counters.reduce<ReplayState>((state, counter) => {
    const result = checkCounter(state, counter, window)
    if (!result.accepted) throw new Error(`rejected ${String(counter)}`)
    return result.next
  }, INITIAL_REPLAY)
}

describe('リプレイの窓', () => {
  it('順に届いたものは受け入れ、同じカウンターは 2 度目を捨てる', () => {
    const state = feed([0, 1, 2, 3, 4, 5, 6, 7])
    expect(describeReplay(state)).toBe('greatest 7, seen 0–7')
    expect(checkCounter(state, 5)).toEqual({ accepted: false, reason: 'duplicate' })
  })

  it('窓の中なら順序が入れ替わっても受け入れる', () => {
    const state = feed([0, 3])
    const late = checkCounter(state, 1)
    expect(late.accepted && late.reason).toBe('late')
  })

  it('窓より古いものは捨てる（境目の確認）', () => {
    const state = feed([100], 16)
    expect(checkCounter(state, 84, 16).accepted).toBe(true)
    expect(checkCounter(state, 83, 16)).toEqual({ accepted: false, reason: 'tooOld' })
  })

  it('Linux の 64 ビットの環境での窓は 8128', () => {
    expect(REPLAY_WINDOW).toBe(8128)
    const state = feed([10_000])
    expect(checkCounter(state, 10_000 - 8128).accepted).toBe(true)
    expect(checkCounter(state, 10_000 - 8129).accepted).toBe(false)
  })
})
