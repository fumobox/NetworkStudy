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
 * ステップ列が変わったとき（オプションの変更など）は、呼び出し側が `{ type: 'reset', stepCount }` を送る。
 */
export function useScenarioPlayer(
  stepCount: number,
  initialStepIndex = 0,
): readonly [PlayerState, ActionDispatch<[action: PlayerAction]>] {
  const [state, dispatch] = useReducer(playerReducer, undefined, () =>
    createPlayerState(stepCount, initialStepIndex),
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
