import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readStorage, writeStorage } from './storage'

const schema = z.object({ count: z.number() })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readStorage / writeStorage', () => {
  it('保存した値をスキーマで検証して読み出す', () => {
    writeStorage('k', { count: 3 })
    expect(readStorage('k', schema)).toEqual({ count: 3 })
  })

  it('値がなければ null', () => {
    expect(readStorage('missing', schema)).toBeNull()
  })

  it('JSON として壊れていれば null', () => {
    window.localStorage.setItem('k', '{broken')
    expect(readStorage('k', schema)).toBeNull()
  })

  it('スキーマに合わなければ null', () => {
    writeStorage('k', { count: 'three' })
    expect(readStorage('k', schema)).toBeNull()
  })

  it('ストレージが使えない環境では読み書きとも例外を投げない', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => {
      writeStorage('k', { count: 1 })
    }).not.toThrow()
    expect(readStorage('k', schema)).toBeNull()
  })
})
