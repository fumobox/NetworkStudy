import { Lock, Timer } from 'lucide-react'
import { m, useReducedMotionConfig } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { useMediaQuery } from '@/lib/hooks/useMediaQuery'
import { formatSeconds, useLocale, useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { clampStepIndex } from '../derive'
import { diagramRows, hasTimers, type DiagramRow } from '../diagram'
import type { Actor, ActorId, Message, MessageId, Step, TimerEvent } from '../types'
import { useActorName } from './useActorName'

const LANE_WIDTH = 180
/** 狭い画面ではレーンを詰め、アクターの短縮名を使う */
const COMPACT_LANE_WIDTH = 112
const COMPACT_MEDIA_QUERY = '(max-width: 640px)'
/** 最新のメッセージの線を伸ばす時間 */
const DRAW_DURATION_S = 0.5
const TIME_COLUMN_WIDTH = 72
const HEADER_HEIGHT = 48
const ROW_HEIGHT = 56
const BOTTOM_PADDING = 16
const ARROW_SIZE = 8
const ICON_SIZE = 14

// 図の中の記号（翻訳しない）。意味は aria-label で伝える
const LOST_MARK = '×'
const REJECTED_MARK = '✗'
const RETRANSMIT_MARK = '↻'

interface SequenceDiagramProps {
  actors: readonly Actor[]
  steps: readonly Step[]
  stepIndex: number
  selectedMessageId: MessageId | null
  /** 選択中のメッセージをもう一度押すと null（選択解除）を渡す */
  onSelectMessage: (messageId: MessageId | null) => void
}

/** アクターの列 × メッセージの行で、steps[0..stepIndex] のやり取りを描く（stepIndex は丸める） */
export function SequenceDiagram({
  actors,
  steps,
  stepIndex,
  selectedMessageId,
  onSelectMessage,
}: SequenceDiagramProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()

  const currentStep = clampStepIndex(steps.length, stepIndex)
  const rows = diagramRows(steps, currentStep)
  const showElapsed = hasTimers(steps)
  const compact = useMediaQuery(COMPACT_MEDIA_QUERY)
  // OS の「視差効果を減らす」設定と、MotionConfig の reducedMotion を尊重する
  const animate = useReducedMotionConfig() !== true
  const laneWidth = compact ? COMPACT_LANE_WIDTH : LANE_WIDTH
  const offsetX = showElapsed ? TIME_COLUMN_WIDTH : 0
  const width = offsetX + actors.length * laneWidth
  const height = HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + BOTTOM_PADDING

  const laneX = new Map<ActorId, number>(
    actors.map((actor, i) => [actor.id, offsetX + i * laneWidth + laneWidth / 2]),
  )
  const actorName = useActorName(actors)
  // 矢印の上にラベルを置くため、行の中心より少し下に線を引く
  const rowY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 8

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <svg
        role="group"
        aria-label={m.diagram.label}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        className="text-foreground select-none"
      >
        {actors.map((actor) => {
          const x = laneX.get(actor.id) ?? 0
          return (
            <g key={actor.id}>
              <text x={x} y={24} textAnchor="middle" className="fill-current text-sm font-semibold">
                {t(compact ? (actor.shortName ?? actor.name) : actor.name)}
              </text>
              <line
                x1={x}
                x2={x}
                y1={HEADER_HEIGHT - 12}
                y2={height - BOTTOM_PADDING / 2}
                className="stroke-muted-foreground/40"
                strokeDasharray="4 4"
              />
            </g>
          )
        })}

        {rows.length === 0 && (
          <text
            x={width / 2}
            y={rowY(0)}
            textAnchor="middle"
            className="fill-muted-foreground text-sm"
          >
            {m.diagram.empty}
          </text>
        )}

        {rows.map((row, i) => {
          const y = rowY(i)
          return (
            <g key={rowKey(row, i)}>
              {showElapsed && (
                <text
                  x={8}
                  y={y + 4}
                  className="fill-muted-foreground font-mono text-xs"
                  data-elapsed
                >
                  {m.diagram.elapsed({ time: formatSeconds(locale, row.elapsedMs) })}
                </text>
              )}
              {row.kind === 'message' ? (
                <MessageArrow
                  message={row.message}
                  x1={laneX.get(row.message.from) ?? 0}
                  x2={laneX.get(row.message.to) ?? 0}
                  y={y}
                  isCurrent={row.stepIndex === currentStep}
                  animate={animate && row.stepIndex === currentStep}
                  isSelected={row.message.id === selectedMessageId}
                  label={m.diagram.message({
                    label: row.message.label,
                    from: actorName(row.message.from),
                    to: actorName(row.message.to),
                    status: m.diagram.status[row.message.status],
                    retransmission: row.message.retransmitOf !== undefined,
                    encrypted: row.message.encrypted === true,
                  })}
                  onSelect={onSelectMessage}
                />
              ) : (
                <TimerMark
                  timer={row.timer}
                  x={laneX.get(row.timer.actorId) ?? 0}
                  y={y}
                  text={m.diagram.timer({
                    name: row.timer.name,
                    duration: formatSeconds(locale, row.timer.durationMs),
                  })}
                  label={m.diagram.timerLabel({
                    actor: actorName(row.timer.actorId),
                    name: row.timer.name,
                    duration: formatSeconds(locale, row.timer.durationMs),
                  })}
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function rowKey(row: DiagramRow, i: number): string {
  return row.kind === 'message' ? `message:${row.message.id}` : `timer:${String(i)}`
}

interface MessageArrowProps {
  message: Message
  x1: number
  x2: number
  y: number
  isCurrent: boolean
  /** 線を送信側から伸ばし、矢先とラベルをフェードインする（現在のステップのみ。reduced motion では false） */
  animate: boolean
  isSelected: boolean
  label: string
  onSelect: (messageId: MessageId | null) => void
}

function MessageArrow({
  message,
  x1,
  x2,
  y,
  isCurrent,
  animate,
  isSelected,
  label,
  onSelect,
}: MessageArrowProps) {
  const direction = x2 >= x1 ? 1 : -1
  const isLost = message.status === 'lost'
  const isRejected = message.status === 'rejected'
  const midX = (x1 + x2) / 2
  const endX = isLost ? midX : x2
  const caption =
    message.retransmitOf === undefined ? message.label : `${message.label} ${RETRANSMIT_MARK}`
  const toggle = () => {
    onSelect(isSelected ? null : message.id)
  }

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }

  const decorations = (
    <>
      {message.encrypted === true && (
        <Lock
          x={x1 + direction * 8 - (direction < 0 ? ICON_SIZE : 0)}
          y={y - 8 - ICON_SIZE}
          size={ICON_SIZE}
          className="stroke-current"
          aria-hidden
        />
      )}
      <text
        x={midX}
        y={y - 8}
        textAnchor="middle"
        className={cn('fill-current font-mono text-xs', isCurrent && 'font-bold')}
        aria-hidden
      >
        {caption}
      </text>
      {isLost ? (
        <text
          x={midX}
          y={y + 5}
          textAnchor="middle"
          className="fill-current text-base font-bold"
          aria-hidden
        >
          {LOST_MARK}
        </text>
      ) : (
        <path
          d={`M ${String(x2)} ${String(y)} l ${String(-direction * ARROW_SIZE)} ${String(-ARROW_SIZE / 2)} v ${String(ARROW_SIZE)} z`}
          className="fill-current"
        />
      )}
      {isRejected && (
        <text
          x={x2 - direction * 16}
          y={y + 18}
          textAnchor="middle"
          className="fill-current text-sm font-bold"
          aria-hidden
        >
          {REJECTED_MARK}
        </text>
      )}
    </>
  )

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={isSelected}
      data-status={message.status}
      data-current={isCurrent}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className={cn(
        'group cursor-pointer outline-none',
        isLost || isRejected ? 'text-destructive' : 'text-foreground',
        isSelected && !isLost && !isRejected && 'text-primary',
      )}
    >
      {/* クリックしやすいように、行全体を当たり判定にする */}
      <rect
        x={Math.min(x1, x2) - 12}
        y={y - ROW_HEIGHT / 2 + 4}
        width={Math.abs(x2 - x1) + 24}
        height={ROW_HEIGHT - 8}
        rx={6}
        className={cn(
          // --ring は背景とのコントラストが 3:1 に届かないため、フォーカスは foreground の太線で示す
          'fill-transparent stroke-transparent group-focus-visible:stroke-foreground',
          isSelected && 'fill-accent',
        )}
        strokeWidth={3}
        aria-hidden
      />
      {/*
        アニメーションする行だけ Motion の要素にする。Motion は一度管理した値を素の属性で上書きさせないため、
        アニメーションしない行を Motion の要素のままにすると、レーン幅が変わったときに線の終点が古い位置に残る
      */}
      {animate ? (
        <>
          <m.line
            x1={x1}
            y1={y}
            y2={y}
            className="stroke-current"
            strokeWidth={isSelected ? 2.5 : 1.5}
            strokeDasharray={message.retransmitOf === undefined ? undefined : '6 4'}
            initial={{ x2: x1 }}
            animate={{ x2: endX }}
            transition={{ duration: DRAW_DURATION_S, ease: 'easeOut' }}
          />
          <m.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: DRAW_DURATION_S * 0.8, duration: 0.2 }}
          >
            {decorations}
          </m.g>
        </>
      ) : (
        <>
          <line
            x1={x1}
            y1={y}
            y2={y}
            className="stroke-current"
            strokeWidth={isSelected ? 2.5 : 1.5}
            strokeDasharray={message.retransmitOf === undefined ? undefined : '6 4'}
            x2={endX}
          />
          <g>{decorations}</g>
        </>
      )}
    </g>
  )
}

interface TimerMarkProps {
  timer: TimerEvent
  x: number
  y: number
  text: string
  label: string
}

function TimerMark({ timer, x, y, text, label }: TimerMarkProps) {
  return (
    <g role="img" aria-label={label} data-timer={timer.name} className="text-muted-foreground">
      <circle cx={x} cy={y} r={4} className="fill-current" />
      <Timer
        x={x + 8}
        y={y - ICON_SIZE / 2}
        size={ICON_SIZE}
        className="stroke-current"
        aria-hidden
      />
      <text x={x + 10 + ICON_SIZE} y={y + 4} className="fill-current font-mono text-xs">
        {text}
      </text>
    </g>
  )
}
