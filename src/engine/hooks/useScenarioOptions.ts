import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { OptionValue, ScenarioHandle, ScenarioOptions, Step } from '../types'
import {
  optionParamsKey,
  readOptionParams,
  readStepParam,
  writeScenarioParams,
  writeStepParam,
} from '../url'

export interface ScenarioSession {
  readonly options: ScenarioOptions
  readonly steps: readonly Step[]
  /**
   * オプションの組み合わせを表す文字列。プレイヤーを持つコンポーネントの key に使い、
   * オプションが変わったら再マウントして最初のステップから始める
   */
  readonly optionsKey: string
  /** URL の ?step= から読んだ初期ステップ（0 始まり。丸めはプレイヤーが行う） */
  readonly initialStepIndex: number
  /** 今の URL の ?step=（0 始まり）。戻る・進むやリンクで外から変わったことの検出に使う */
  readonly urlStepIndex: number
  /** オプションを変更する。URL を更新し、ステップは最初に戻る */
  readonly setOption: (key: string, value: OptionValue) => void
  /** 現在のステップを URL に書き戻す（値が同じなら何もしない） */
  readonly syncStep: (stepIndex: number) => void
}

/** シナリオのオプションとステップを URL のクエリ（`?step=&opt.*=`）と同期する */
export function useScenarioOptions(handle: ScenarioHandle): ScenarioSession {
  const [params, setParams] = useSearchParams()
  const optionsKey = optionParamsKey(params)
  const resolved = useMemo(
    () => handle.resolve(readOptionParams(new URLSearchParams(optionsKey))),
    [handle, optionsKey],
  )
  const currentStep = readStepParam(params) ?? 0

  const setOption = useCallback(
    (key: string, value: OptionValue) => {
      setParams(
        (previous) =>
          writeScenarioParams(previous, {
            optionDefs: handle.optionDefs,
            options: { ...resolved.options, [key]: value },
            stepIndex: 0,
          }),
        { replace: true },
      )
    },
    [handle.optionDefs, resolved.options, setParams],
  )

  const syncStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex === currentStep) {
        return
      }
      // ステップだけを書き換える。オプションまで書き直すと、直前のオプション変更を古い値で巻き戻すことがある
      setParams((previous) => writeStepParam(previous, stepIndex), { replace: true })
    },
    [currentStep, setParams],
  )

  return {
    options: resolved.options,
    steps: resolved.steps,
    optionsKey,
    initialStepIndex: currentStep,
    urlStepIndex: currentStep,
    setOption,
    syncStep,
  }
}
