import { useEffect, useEffectEvent, useRef, type ActionDispatch } from 'react'
import { clampStepIndex } from '../derive'
import type { PlayerAction, PlayerState } from '../player'
import type { StepParam } from './useStepParam'

interface StepUrlSyncOptions extends StepParam {
  readonly stepCount: number
  readonly state: PlayerState
  readonly dispatch: ActionDispatch<[action: PlayerAction]>
}

/**
 * プレイヤーのステップと URL の ?step= を双方向に同期する。
 * - プレイヤー → URL: ステップが変わったら書き戻す
 * - URL → プレイヤー: 戻る・進むやリンクで ?step= だけが外から変わったら、そのステップへ移る
 * 最後に書いた値を覚えておき、自分で書いた変更と外からの変更を区別する
 */
export function useStepUrlSync({
  stepCount,
  state,
  dispatch,
  urlStepIndex,
  syncStep,
}: StepUrlSyncOptions) {
  const lastWrittenStep = useRef(state.stepIndex)
  const writeStep = useEffectEvent((stepIndex: number) => {
    lastWrittenStep.current = stepIndex
    syncStep(stepIndex)
  })
  useEffect(() => {
    writeStep(state.stepIndex)
  }, [state.stepIndex])

  const followUrl = useEffectEvent((stepIndex: number) => {
    if (stepIndex === lastWrittenStep.current) {
      return
    }
    if (clampStepIndex(stepCount, stepIndex) === state.stepIndex) {
      // 範囲外の値が来ても丸めると今のステップのままなら、プレイヤーは変わらないので URL だけ正規化する
      writeStep(state.stepIndex)
    } else {
      dispatch({ type: 'jump', stepIndex })
    }
  })
  useEffect(() => {
    followUrl(urlStepIndex)
  }, [urlStepIndex])
}
