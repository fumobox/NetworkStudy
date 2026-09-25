import { clampStepIndex } from './derive'
import type { MessageId } from './types'

export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** 等速（1x）での自動再生の 1 ステップあたりの時間 */
export const BASE_STEP_INTERVAL_MS = 2000

export function stepIntervalMs(speed: PlaybackSpeed): number {
  return BASE_STEP_INTERVAL_MS / speed
}

export interface PlayerState {
  readonly stepCount: number
  /** 0 始まり。URL の ?step= は 1 始まりで変換する。ステップがなければ -1 */
  readonly stepIndex: number
  readonly isPlaying: boolean
  readonly speed: PlaybackSpeed
  /** null = 現在ステップの最新メッセージを表示する（明示的な選択なし） */
  readonly selectedMessageId: MessageId | null
}

export type PlayerAction =
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'jump'; readonly stepIndex: number }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  /** 自動再生のタイマーから送る。最終ステップに達したら止まる */
  | { readonly type: 'tick' }
  /** ステップ列が変わったとき（オプションの変更など）に送る。最初のステップに戻して停止する */
  | { readonly type: 'reset'; readonly stepCount: number }
  | { readonly type: 'setSpeed'; readonly speed: PlaybackSpeed }
  | { readonly type: 'selectMessage'; readonly messageId: MessageId | null }

export function createPlayerState(
  stepCount: number,
  stepIndex = 0,
  speed: PlaybackSpeed = 1,
): PlayerState {
  return {
    stepCount,
    stepIndex: clampStepIndex(stepCount, stepIndex),
    isPlaying: false,
    speed,
    selectedMessageId: null,
  }
}

export function isLastStep(state: PlayerState): boolean {
  return state.stepIndex >= state.stepCount - 1
}

/** ステップを移動する。移動したら選択を解除する。移動しなければ同じオブジェクトを返す */
function moveTo(state: PlayerState, index: number): PlayerState {
  const stepIndex = clampStepIndex(state.stepCount, index)
  if (stepIndex === state.stepIndex) {
    return state
  }
  return { ...state, stepIndex, selectedMessageId: null }
}

function pause(state: PlayerState): PlayerState {
  return state.isPlaying ? { ...state, isPlaying: false } : state
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    // 再生中に手動で移動したら一時停止する（タイマーとの競合で 2 段進むのを防ぐ）
    case 'next':
      return pause(moveTo(state, state.stepIndex + 1))
    case 'prev':
      return pause(moveTo(state, state.stepIndex - 1))
    case 'jump':
      return pause(moveTo(state, action.stepIndex))
    case 'play': {
      if (state.stepCount <= 1 || state.isPlaying) {
        return state
      }
      // 最後まで再生し終えていたら、最初から再生する
      const from = isLastStep(state) ? moveTo(state, 0) : state
      return { ...from, isPlaying: true }
    }
    case 'pause':
      return pause(state)
    case 'tick': {
      if (!state.isPlaying) {
        return state
      }
      const moved = moveTo(state, state.stepIndex + 1)
      return isLastStep(moved) ? { ...moved, isPlaying: false } : moved
    }
    case 'reset':
      return createPlayerState(action.stepCount, 0, state.speed)
    case 'setSpeed':
      return action.speed === state.speed ? state : { ...state, speed: action.speed }
    case 'selectMessage':
      return action.messageId === state.selectedMessageId
        ? state
        : { ...state, selectedMessageId: action.messageId }
  }
}
