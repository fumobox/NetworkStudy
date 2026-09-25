import type { KeyboardEvent } from 'react'
import { formatSeconds, useLocale, useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { diagramRows, hasTimers, type DiagramRow } from '../diagram'
import type { Actor, ActorId, Message, MessageId, Step, TimerEvent } from '../types'

const LANE_WIDTH = 180
const TIME_COLUMN_WIDTH = 72
const HEADER_HEIGHT = 48
const ROW_HEIGHT = 56
const BOTTOM_PADDING = 16
const ARROW_SIZE = 8

// 図の中の記号（翻訳しない）。意味は aria-label で伝える
const LOST_MARK = '×'
const REJECTED_MARK = '✗'
const RETRANSMIT_MARK = '↻'
const ENCRYPTED_MARK = '🔒'
const TIMER_MARK = '⏱'

interface SequenceDiagramProps {
  actors: readonly Actor[]
  steps: readonly Step[]
  stepIndex: number
  selectedMessageId: MessageId | null
  onSelectMessage: (messageId: MessageId) => void
}

/** アクターの列 × メッセージの行で、steps[0..stepIndex] のやり取りを描く */
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

  const rows = diagramRows(steps, stepIndex)
  const showElapsed = hasTimers(steps)
  const offsetX = showElapsed ? TIME_COLUMN_WIDTH : 0
  const width = offsetX + actors.length * LANE_WIDTH
  const height = HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + BOTTOM_PADDING

  const laneX = new Map<ActorId, number>(
    actors.map((actor, i) => [actor.id, offsetX + i * LANE_WIDTH + LANE_WIDTH / 2]),
  )
  const actorName = (actorId: ActorId): string => {
    const actor = actors.find((candidate) => candidate.id === actorId)
    return actor === undefined ? actorId : t(actor.name)
  }
  const rowY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 8

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <svg
        role="group"
        aria-label={m.diagram.label}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        className="max-w-none text-foreground select-none"
      >
        {actors.map((actor) => {
          const x = laneX.get(actor.id) ?? 0
          return (
            <g key={actor.id}>
              <text x={x} y={24} textAnchor="middle" className="fill-current text-sm font-semibold">
                {t(actor.name)}
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
                <text x={8} y={y + 4} className="fill-muted-foreground font-mono text-xs">
                  {m.diagram.elapsed({ time: formatSeconds(locale, row.elapsedMs) })}
                </text>
              )}
              {row.kind === 'message' ? (
                <MessageArrow
                  message={row.message}
                  x1={laneX.get(row.message.from) ?? 0}
                  x2={laneX.get(row.message.to) ?? 0}
                  y={y}
                  isCurrent={row.stepIndex === stepIndex}
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
  isSelected: boolean
  label: string
  onSelect: (messageId: MessageId) => void
}

function MessageArrow({
  message,
  x1,
  x2,
  y,
  isCurrent,
  isSelected,
  label,
  onSelect,
}: MessageArrowProps) {
  const direction = x2 >= x1 ? 1 : -1
  const isLost = message.status === 'lost'
  const isRejected = message.status === 'rejected'
  const midX = (x1 + x2) / 2
  const endX = isLost ? midX : x2
  const caption = [
    message.encrypted === true ? ENCRYPTED_MARK : null,
    message.label,
    message.retransmitOf === undefined ? null : RETRANSMIT_MARK,
  ]
    .filter((part) => part !== null)
    .join(' ')

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(message.id)
    }
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={isSelected}
      data-status={message.status}
      onClick={() => {
        onSelect(message.id)
      }}
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
          'fill-transparent stroke-transparent group-focus-visible:stroke-ring',
          isSelected && 'fill-accent',
        )}
        strokeWidth={2}
      />
      <text
        x={midX}
        y={y - 8}
        textAnchor="middle"
        className={cn('fill-current font-mono text-xs', isCurrent && 'font-bold')}
      >
        {caption}
      </text>
      <line
        x1={x1}
        x2={endX}
        y1={y}
        y2={y}
        className="stroke-current"
        strokeWidth={isSelected ? 2.5 : 1.5}
        strokeDasharray={message.retransmitOf === undefined ? undefined : '6 4'}
      />
      {isLost ? (
        <text x={midX} y={y + 5} textAnchor="middle" className="fill-current text-base font-bold">
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
        >
          {REJECTED_MARK}
        </text>
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
  const caption = `${TIMER_MARK} ${text}`
  return (
    <g role="img" aria-label={label} data-timer={timer.name} className="text-muted-foreground">
      <circle cx={x} cy={y} r={4} className="fill-current" />
      <text x={x + 10} y={y + 4} className="fill-current font-mono text-xs">
        {caption}
      </text>
    </g>
  )
}
