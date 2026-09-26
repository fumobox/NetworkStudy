import { useId, useMemo } from 'react'
import { deriveState } from '@/engine/derive'
import type { ScenarioPanelsContext } from '@/engine/ui/ScenarioPlayer'
import { useText } from '@/lib/i18n'
import { graphLayout, parseCwndHistory, polylinePoints, toPoint, type CwndRound } from './graphData'
import { CWND_TEXT as TEXT, cwndSummary } from './cwndText'
import { CWND_HISTORY, EVENTS, tcpCongestionScenario, type LossMode } from './scenario'

/** 輪の半径（現在のラウンドは大きくする） */
const POINT_RADIUS = 4
const CURRENT_POINT_RADIUS = 7
/** ロスを検出したラウンドの印（色だけに頼らない） */
const LOSS_MARK = '✕'
const LOSS_EVENTS: ReadonlySet<string> = new Set([EVENTS.fastRetransmit, EVENTS.rto])

function isLossMode(value: unknown): value is LossMode {
  return value === 'none' || value === 'dupack' || value === 'rto'
}

/** そのシナリオの最後までのラウンド（軸の範囲を決めるため） */
function allRoundsFor(loss: LossMode): readonly CwndRound[] {
  const steps = tcpCongestionScenario.buildSteps({ loss })
  const derived = deriveState(tcpCongestionScenario.actors, steps, steps.length - 1)
  return parseCwndHistory(derived.actorStates.client?.values[CWND_HISTORY])
}

/** ラウンドごとの cwnd と ssthresh の折れ線グラフ。同じ数値を表でも読めるようにする */
export function CwndGraph({ derived, options }: ScenarioPanelsContext) {
  const t = useText()
  const titleId = useId()
  const loss = isLossMode(options.loss) ? options.loss : 'none'
  const layout = useMemo(() => graphLayout(allRoundsFor(loss)), [loss])
  const rounds = parseCwndHistory(derived.actorStates.client?.values[CWND_HISTORY])
  const cwndPoints = rounds.map((round) => toPoint(layout, round.round, round.cwnd))
  // ssthresh は各ラウンドの間は一定なので、階段状（ラウンドの半分ずつ左右に伸ばす）に描く
  const halfStep =
    layout.maxRound === 1 ? 0 : (layout.plot.right - layout.plot.left) / (layout.maxRound - 1) / 2
  const ssthreshPoints = rounds.flatMap((round) => {
    const center = toPoint(layout, round.round, round.ssthresh)
    return [
      { x: Math.max(center.x - halfStep, layout.plot.left), y: center.y },
      { x: Math.min(center.x + halfStep, layout.plot.right), y: center.y },
    ]
  })
  const yTicks = Array.from({ length: layout.maxValue + 1 }, (_, value) => value).filter(
    (value) => value % 2 === 0,
  )

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="font-heading text-base font-semibold">
        {t(TEXT.title)}
      </h2>
      {rounds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(TEXT.empty)}</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-4 text-xs" aria-hidden>
            <li className="flex items-center gap-1">
              <svg width="24" height="8" className="text-primary">
                <line x1="0" y1="4" x2="24" y2="4" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="4" r="3" fill="currentColor" />
              </svg>
              {t(TEXT.cwnd)}
            </li>
            <li className="flex items-center gap-1">
              <svg width="24" height="8" className="text-muted-foreground">
                <line
                  x1="0"
                  y1="4"
                  x2="24"
                  y2="4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                />
              </svg>
              {t(TEXT.ssthresh)}
            </li>
            <li className="flex items-center gap-1">
              <span className="font-bold text-destructive">{LOSS_MARK}</span>
              {t(TEXT.lossLegend)}
            </li>
          </ul>
          <svg
            role="img"
            aria-label={t(cwndSummary(rounds.map((round) => round.cwnd)))}
            viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
            className="w-full max-w-2xl"
          >
            {/* 軸と目盛り */}
            <g className="text-muted-foreground" fontSize="11">
              {yTicks.map((value) => {
                const { y } = toPoint(layout, 1, value)
                return (
                  <g key={value}>
                    <line
                      x1={layout.plot.left}
                      x2={layout.plot.right}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.2"
                    />
                    <text x={layout.plot.left - 8} y={y + 4} textAnchor="end" fill="currentColor">
                      {value}
                    </text>
                  </g>
                )
              })}
              {Array.from({ length: layout.maxRound }, (_, index) => index + 1).map((round) => {
                const { x } = toPoint(layout, round, 0)
                return (
                  <text
                    key={round}
                    x={x}
                    y={layout.plot.bottom + 16}
                    textAnchor="middle"
                    fill="currentColor"
                  >
                    {round}
                  </text>
                )
              })}
              <text
                x={(layout.plot.left + layout.plot.right) / 2}
                y={layout.height - 2}
                textAnchor="middle"
                fill="currentColor"
              >
                {t(TEXT.xAxis)}
              </text>
              <text
                x={12}
                y={(layout.plot.top + layout.plot.bottom) / 2}
                textAnchor="middle"
                fill="currentColor"
                transform={`rotate(-90 12 ${String((layout.plot.top + layout.plot.bottom) / 2)})`}
              >
                {t(TEXT.yAxis)}
              </text>
            </g>
            <polyline
              points={polylinePoints(ssthreshPoints)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="6 4"
              className="text-muted-foreground"
            />
            <g className="text-primary">
              <polyline
                points={polylinePoints(cwndPoints)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              {rounds.map((round, index) => {
                const point = cwndPoints[index]
                if (point === undefined) {
                  return null
                }
                const current = index === rounds.length - 1
                return (
                  <g key={round.round}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={current ? CURRENT_POINT_RADIUS : POINT_RADIUS}
                      fill={current ? 'var(--background)' : 'currentColor'}
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    {LOSS_EVENTS.has(round.event) && (
                      <text
                        x={point.x}
                        y={point.y - 12}
                        textAnchor="middle"
                        fontSize="14"
                        fontWeight="bold"
                        className="fill-destructive"
                      >
                        {LOSS_MARK}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
          {/* 表は width: 1px を無視して広がるので、sr-only は外側の div に付ける（狭い画面で横にはみ出さない） */}
          <div className="sr-only">
            <table>
              <caption>{t(TEXT.tableCaption)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(TEXT.xAxis)}</th>
                  <th scope="col">{t(TEXT.cwnd)}</th>
                  <th scope="col">{t(TEXT.ssthresh)}</th>
                  <th scope="col">{t(TEXT.event)}</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <tr key={round.round}>
                    <th scope="row">{round.round}</th>
                    <td>{round.cwnd}</td>
                    <td>{round.ssthresh}</td>
                    <td>{t(TEXT.events[round.event])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
