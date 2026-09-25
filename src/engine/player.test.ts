// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createPlayerState,
  playerReducer,
  stepIntervalMs,
  type PlayerAction,
  type PlayerState,
} from './player'

const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state)

describe('createPlayerState', () => {
  it('停止状態・等速・選択なしで作る。ステップ番号は丸める', () => {
    expect(createPlayerState(4)).toEqual({
      stepCount: 4,
      stepIndex: 0,
      isPlaying: false,
      speed: 1,
      selectedMessageId: null,
    })
    expect(createPlayerState(4, 10).stepIndex).toBe(3)
    expect(createPlayerState(0).stepIndex).toBe(-1)
  })
})

describe('playerReducer', () => {
  const initial = createPlayerState(4)

  it('next / prev は範囲内で移動する', () => {
    expect(run(initial, { type: 'next' }, { type: 'next' }).stepIndex).toBe(2)
    expect(run(initial, { type: 'prev' }).stepIndex).toBe(0)
    expect(run(createPlayerState(4, 3), { type: 'next' }).stepIndex).toBe(3)
  })

  it('jump は丸める', () => {
    expect(run(initial, { type: 'jump', stepIndex: 2 }).stepIndex).toBe(2)
    expect(run(initial, { type: 'jump', stepIndex: 99 }).stepIndex).toBe(3)
    expect(run(initial, { type: 'jump', stepIndex: -1 }).stepIndex).toBe(0)
  })

  it('状態が変わらない操作では同じオブジェクトを返す', () => {
    expect(playerReducer(initial, { type: 'prev' })).toBe(initial)
    expect(playerReducer(initial, { type: 'jump', stepIndex: 0 })).toBe(initial)
    expect(playerReducer(initial, { type: 'pause' })).toBe(initial)
    expect(playerReducer(initial, { type: 'tick' })).toBe(initial)
    expect(playerReducer(initial, { type: 'setSpeed', speed: 1 })).toBe(initial)
    expect(playerReducer(initial, { type: 'selectMessage', messageId: null })).toBe(initial)
  })

  it('ステップを移動すると選択を解除する', () => {
    const selected = run(initial, { type: 'selectMessage', messageId: 'syn' })
    expect(selected.selectedMessageId).toBe('syn')
    expect(run(selected, { type: 'next' }).selectedMessageId).toBeNull()
    expect(run(selected, { type: 'jump', stepIndex: 2 }).selectedMessageId).toBeNull()
    // 移動しなければ選択を保つ
    expect(run(selected, { type: 'prev' }).selectedMessageId).toBe('syn')
  })

  it('tick で進み、最終ステップに達したら停止する', () => {
    const playing = run(initial, { type: 'play' })
    expect(playing.isPlaying).toBe(true)
    const afterTwo = run(playing, { type: 'tick' }, { type: 'tick' })
    expect(afterTwo).toMatchObject({ stepIndex: 2, isPlaying: true })
    expect(run(afterTwo, { type: 'tick' })).toMatchObject({ stepIndex: 3, isPlaying: false })
  })

  it('再生中に手動で移動したら一時停止する', () => {
    const playing = run(initial, { type: 'play' })
    expect(run(playing, { type: 'next' })).toMatchObject({ stepIndex: 1, isPlaying: false })
    expect(run(playing, { type: 'prev' }).isPlaying).toBe(false)
    expect(run(playing, { type: 'jump', stepIndex: 3 })).toMatchObject({
      stepIndex: 3,
      isPlaying: false,
    })
  })

  it('末尾での next は同じオブジェクトを返す', () => {
    const last = createPlayerState(4, 3)
    expect(playerReducer(last, { type: 'next' })).toBe(last)
  })

  it('togglePlay は再生と一時停止を切り替える', () => {
    const playing = run(initial, { type: 'togglePlay' })
    expect(playing.isPlaying).toBe(true)
    expect(run(playing, { type: 'togglePlay' }).isPlaying).toBe(false)
    expect(run(createPlayerState(4, 3), { type: 'togglePlay' })).toMatchObject({
      stepIndex: 0,
      isPlaying: true,
    })
  })

  it('停止中の tick では進まない', () => {
    expect(run(initial, { type: 'play' }, { type: 'pause' }, { type: 'tick' }).stepIndex).toBe(0)
  })

  it('最後まで再生し終えていたら、play で最初から再生する', () => {
    expect(run(createPlayerState(4, 3), { type: 'play' })).toMatchObject({
      stepIndex: 0,
      isPlaying: true,
    })
  })

  it('ステップが 1 つ以下なら再生しない', () => {
    const single = createPlayerState(1)
    expect(playerReducer(single, { type: 'play' })).toBe(single)
    expect(playerReducer(createPlayerState(0), { type: 'play' }).isPlaying).toBe(false)
  })

  it('reset は新しいステップ数で最初に戻して停止し、速度は保つ', () => {
    const state = run(initial, { type: 'setSpeed', speed: 2 }, { type: 'next' }, { type: 'play' })
    expect(run(state, { type: 'reset', stepCount: 6 })).toEqual({
      stepCount: 6,
      stepIndex: 0,
      isPlaying: false,
      speed: 2,
      selectedMessageId: null,
    })
  })
})

describe('stepIntervalMs', () => {
  it('速度に反比例する', () => {
    expect(stepIntervalMs(1)).toBe(2000)
    expect(stepIntervalMs(2)).toBe(1000)
    expect(stepIntervalMs(0.5)).toBe(4000)
  })
})
