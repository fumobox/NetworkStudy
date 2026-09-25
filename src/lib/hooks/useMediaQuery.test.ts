import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  let matches = initial
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    listeners,
    change(next: boolean) {
      matches = next
      listeners.forEach((listener) => {
        listener()
      })
    },
  }
}

describe('useMediaQuery', () => {
  it('matchMedia がなければ false', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'))
    expect(result.current).toBe(false)
  })

  it('一致状態を返し、変化に追従する。アンマウントで購読を解除する', () => {
    const media = stubMatchMedia(true)
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 640px)'))
    expect(result.current).toBe(true)
    act(() => {
      media.change(false)
    })
    expect(result.current).toBe(false)
    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
