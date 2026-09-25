import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScenarioPlayer } from './useScenarioPlayer'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useScenarioPlayer', () => {
  it('初期ステップを指定できる', () => {
    const { result } = renderHook(() => useScenarioPlayer(4, 2))
    expect(result.current[0].stepIndex).toBe(2)
  })

  it('再生中は速度に応じた間隔で進み、最後で止まる', () => {
    const { result } = renderHook(() => useScenarioPlayer(3))
    act(() => {
      result.current[1]({ type: 'play' })
    })
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(result.current[0].stepIndex).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current[0].stepIndex).toBe(1)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current[0]).toMatchObject({ stepIndex: 2, isPlaying: false })
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(result.current[0].stepIndex).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('速度を変えるとタイマーの間隔が変わる', () => {
    const { result } = renderHook(() => useScenarioPlayer(5))
    act(() => {
      result.current[1]({ type: 'setSpeed', speed: 2 })
      result.current[1]({ type: 'play' })
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current[0].stepIndex).toBe(1)
  })

  it('一時停止とアンマウントでタイマーを止める', () => {
    const { result, unmount } = renderHook(() => useScenarioPlayer(5))
    act(() => {
      result.current[1]({ type: 'play' })
    })
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      result.current[1]({ type: 'pause' })
    })
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      result.current[1]({ type: 'play' })
    })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('再生中に速度を変えるとタイマーを張り直す', () => {
    const { result } = renderHook(() => useScenarioPlayer(5))
    act(() => {
      result.current[1]({ type: 'play' })
    })
    act(() => {
      vi.advanceTimersByTime(1500)
      result.current[1]({ type: 'setSpeed', speed: 2 })
    })
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(result.current[0].stepIndex).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current[0].stepIndex).toBe(1)
  })

  it('StrictMode でもタイマーは 1 本だけ', () => {
    const { result } = renderHook(() => useScenarioPlayer(5), { wrapper: StrictMode })
    act(() => {
      result.current[1]({ type: 'play' })
    })
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current[0].stepIndex).toBe(1)
  })

  it('引数はマウント時の初期値としてだけ使う（変更は reset で伝える）', () => {
    const { result, rerender } = renderHook(({ count }) => useScenarioPlayer(count), {
      initialProps: { count: 4 },
    })
    rerender({ count: 2 })
    expect(result.current[0].stepCount).toBe(4)
    act(() => {
      result.current[1]({ type: 'reset', stepCount: 2 })
    })
    expect(result.current[0].stepCount).toBe(2)
  })
})
