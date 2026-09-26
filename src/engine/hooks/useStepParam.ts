import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { readStepParam, writeStepParam } from '../url'

export interface StepParam {
  /** 今の URL の ?step=（0 始まり。丸めはプレイヤーが行う）。ないか不正なら 0 */
  readonly urlStepIndex: number
  /** 現在のステップを URL に書き戻す（値が同じなら何もしない）。履歴は増やさない */
  readonly syncStep: (stepIndex: number) => void
}

/** URL の ?step= を読み書きする（オプションのないステップ実行でも使う） */
export function useStepParam(): StepParam {
  const [params, setParams] = useSearchParams()
  const urlStepIndex = readStepParam(params) ?? 0
  const syncStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex === urlStepIndex) {
        return
      }
      // ステップだけを書き換える。ほかのクエリまで書き直すと、直前の変更を古い値で巻き戻すことがある
      setParams((previous) => writeStepParam(previous, stepIndex), { replace: true })
    },
    [urlStepIndex, setParams],
  )
  return { urlStepIndex, syncStep }
}
