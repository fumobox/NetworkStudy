import { useEffect, useReducer, type ActionDispatch } from 'react'
import {
  createPlayerState,
  playerReducer,
  stepIntervalMs,
  type PlayerAction,
  type PlayerState,
} from '../player'

/**
 * プレイヤーの状態と自動再生のタイマーを管理する。
 *
 * 引数はマウント時の初期値としてだけ使う。ステップ列が変わったとき（オプションの変更など）は、
 * `{ type: 'reset', stepCount }` を送るか、`key` を変えてコンポーネントを再マウントする。
 * 速度を変えると、次のステップまでの待ち時間はその時点から数え直す。
 */
export function useScenarioPlayer(
  initialStepCount: number,
  initialStepIndex = 0,
): readonly [PlayerState, ActionDispatch<[action: PlayerAction]>] {
  const [state, dispatch] = useReducer(playerReducer, undefined, () =>
    createPlayerState(initialStepCount, initialStepIndex),
  )

  useEffect(() => {
    if (!state.isPlaying) {
      return
    }
    const timer = window.setInterval(() => {
      dispatch({ type: 'tick' })
    }, stepIntervalMs(state.speed))
    return () => {
      window.clearInterval(timer)
    }
  }, [state.isPlaying, state.speed])

  return [state, dispatch]
}
