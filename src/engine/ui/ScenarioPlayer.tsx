import { useEffect, useEffectEvent, useMemo, useRef, type ReactNode } from 'react'
import { useMessages } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { clampStepIndex, deriveState } from '../derive'
import { diagramWidth, hasTimers } from '../diagram'
import { useScenarioOptions, type ScenarioSession } from '../hooks/useScenarioOptions'
import { useScenarioPlayer } from '../hooks/useScenarioPlayer'
import { useStepKeyboard } from '../hooks/useStepKeyboard'
import type { DerivedState, ScenarioHandle, ScenarioOptions, StateKey } from '../types'
import { ActorStatePanel } from './ActorStatePanel'
import { PacketInspector } from './PacketInspector'
import { ScenarioOptionsForm } from './ScenarioOptionsForm'
import { SequenceDiagram } from './SequenceDiagram'
import { StepControls } from './StepControls'
import { StepDescription } from './StepDescription'

/**
 * 図をパケットの詳細と横に並べるときの、図の列の幅の目安（px）。
 * 広い画面（max-w-7xl − サイドバー）で 3:2 に分けたときの図の列が約 580px なので、それに収まる図だけ横に並べる
 */
const SIDE_BY_SIDE_MAX_DIAGRAM_WIDTH = 560

export interface ScenarioPanelsContext {
  readonly derived: DerivedState
  readonly options: ScenarioOptions
}

interface ScenarioPlayerProps {
  scenario: ScenarioHandle
  /** テーマ固有のパネル（TLS の証明書チェーンなど） */
  renderPanels?: (context: ScenarioPanelsContext) => ReactNode
  /** テーマ固有のパネルで表示するので、状態パネルには出さないキー */
  hiddenStateKeys?: readonly StateKey[]
}

/** シナリオのステップ実行（オプションのフォーム・操作・図・パケットの詳細・状態）。URL と同期する */
export function ScenarioPlayer({ scenario, renderPanels, hiddenStateKeys }: ScenarioPlayerProps) {
  const m = useMessages()
  const session = useScenarioOptions(scenario)

  // 各パネルの見出し（h2）を束ねる見出しはなく、ランドマークの名前だけを付ける
  return (
    <section aria-label={m.theme.player} className="space-y-6">
      <ScenarioOptionsForm
        optionDefs={scenario.optionDefs}
        options={session.options}
        onChange={session.setOption}
      />
      {/* オプションが変わったら再マウントして、最初のステップから始める */}
      <PlayerBody
        key={session.optionsKey}
        scenario={scenario}
        session={session}
        renderPanels={renderPanels}
        hiddenStateKeys={hiddenStateKeys}
      />
    </section>
  )
}

interface PlayerBodyProps {
  scenario: ScenarioHandle
  session: ScenarioSession
  renderPanels: ScenarioPlayerProps['renderPanels']
  hiddenStateKeys: ScenarioPlayerProps['hiddenStateKeys']
}

function PlayerBody({ scenario, session, renderPanels, hiddenStateKeys }: PlayerBodyProps) {
  const { steps } = session
  const [state, dispatch] = useScenarioPlayer(steps.length, session.initialStepIndex)
  useStepKeyboard(dispatch)

  // プレイヤー → URL: ステップが変わったら書き戻す。最後に書いた値を覚えておき、外からの変更と区別する
  const lastWrittenStep = useRef(state.stepIndex)
  const writeStep = useEffectEvent((stepIndex: number) => {
    lastWrittenStep.current = stepIndex
    session.syncStep(stepIndex)
  })
  useEffect(() => {
    writeStep(state.stepIndex)
  }, [state.stepIndex])

  // URL → プレイヤー: 戻る・進むやリンクで ?step= だけが外から変わったら、そのステップへ移る
  const { urlStepIndex } = session
  const followUrl = useEffectEvent((stepIndex: number) => {
    if (stepIndex === lastWrittenStep.current) {
      return
    }
    if (clampStepIndex(steps.length, stepIndex) === state.stepIndex) {
      // 範囲外の値が来ても丸めると今のステップのままなら、プレイヤーは変わらないので URL だけ正規化する
      writeStep(state.stepIndex)
    } else {
      dispatch({ type: 'jump', stepIndex })
    }
  })
  useEffect(() => {
    followUrl(urlStepIndex)
  }, [urlStepIndex])

  const derived = useMemo(
    () => deriveState(scenario.actors, steps, state.stepIndex),
    [scenario.actors, steps, state.stepIndex],
  )
  const previous = useMemo(
    () => (state.stepIndex > 0 ? deriveState(scenario.actors, steps, state.stepIndex - 1) : null),
    [scenario.actors, steps, state.stepIndex],
  )

  return (
    <div className="space-y-6">
      <StepControls state={state} dispatch={dispatch} />
      <StepDescription step={steps[state.stepIndex]} />
      {/*
        列の最小幅を 0 にして、図や表が長くても狭い画面で横にはみ出さない（はみ出す分は各パネル内でスクロール）。
        図が広い（DNS のようにアクターが多い）ときは横に並べると収まらないので、図を全幅にしてパケットの詳細を下に置く
      */}
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-6',
          diagramWidth(scenario.actors.length, hasTimers(steps)) <=
            SIDE_BY_SIDE_MAX_DIAGRAM_WIDTH && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
        )}
      >
        <SequenceDiagram
          actors={scenario.actors}
          steps={steps}
          stepIndex={state.stepIndex}
          selectedMessageId={state.selectedMessageId}
          onSelectMessage={(messageId) => {
            dispatch({ type: 'selectMessage', messageId })
          }}
        />
        <PacketInspector
          actors={scenario.actors}
          derived={derived}
          selectedMessageId={state.selectedMessageId}
        />
      </div>
      <ActorStatePanel
        actors={scenario.actors}
        derived={derived}
        previous={previous}
        {...(hiddenStateKeys === undefined ? {} : { hiddenStateKeys })}
      />
      {renderPanels?.({ derived, options: session.options })}
    </div>
  )
}
