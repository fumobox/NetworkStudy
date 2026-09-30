// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLD_TIME, keepaliveInterval, negotiateHoldTime } from './fsm'

describe('Hold Time と KEEPALIVE（RFC 4271 §4.2、§10）', () => {
  it('小さい方を使い、KEEPALIVE はその 3 分の 1', () => {
    expect(negotiateHoldTime(DEFAULT_HOLD_TIME, 180)).toBe(90)
    expect(keepaliveInterval(90)).toBe(30)
  })

  it('0 か 3 秒以上でなければならない', () => {
    expect(negotiateHoldTime(0, 90)).toBe(0)
    expect(() => negotiateHoldTime(90, 2)).toThrow()
  })
})
