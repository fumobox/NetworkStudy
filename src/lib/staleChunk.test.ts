// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RELOAD_GUARD_MS, reloadOnStaleChunk, type ReloadTarget } from './staleChunk'

function fakeWindow(options: { storageThrows?: boolean } = {}) {
  const events = new EventTarget()
  const store = new Map<string, string>()
  const reload = vi.fn()
  const target: ReloadTarget = {
    addEventListener: (type, listener) => {
      events.addEventListener(type, listener)
    },
    location: { reload },
    sessionStorage: {
      getItem: (key) => {
        if (options.storageThrows === true) throw new Error('blocked')
        return store.get(key) ?? null
      },
      setItem: (key, value) => {
        if (options.storageThrows === true) throw new Error('blocked')
        store.set(key, value)
      },
    },
  }
  const fire = () => {
    const event = new Event('vite:preloadError', { cancelable: true })
    events.dispatchEvent(event)
    return event
  }
  return { target, reload, fire }
}

describe('reloadOnStaleChunk', () => {
  it('チャンクの読み込みに失敗したら、エラーを止めてページを読み込み直す', () => {
    const { target, reload, fire } = fakeWindow()
    reloadOnStaleChunk(target, () => 1_000_000)
    const event = fire()
    expect(reload).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('読み込み直した直後にまた失敗したら、繰り返さずにエラーを投げさせる', () => {
    let time = 1_000_000
    const { target, reload, fire } = fakeWindow()
    reloadOnStaleChunk(target, () => time)
    fire()
    time += RELOAD_GUARD_MS - 1
    const second = fire()
    expect(reload).toHaveBeenCalledOnce()
    expect(second.defaultPrevented).toBe(false)
    // 時間がたてば、次のデプロイでまた読み込み直せる
    time += RELOAD_GUARD_MS
    fire()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('sessionStorage が使えないときは、繰り返しを止められないので読み込み直さない', () => {
    const { target, reload, fire } = fakeWindow({ storageThrows: true })
    reloadOnStaleChunk(target, () => 1_000_000)
    expect(fire().defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
