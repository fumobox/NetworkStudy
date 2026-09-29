// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canReceive, EMPTY_SLOTS, initiatorAdds, receivedWith, responderAdds } from './keypairs'

describe('鍵の組の入れ替え', () => {
  it('最初のハンドシェイク: 始めた側はすぐ current、応じた側は確認まで next', () => {
    const laptop = initiatorAdds(EMPTY_SLOTS, '#1')
    expect(laptop).toEqual({ previous: null, current: '#1', next: null })
    const server = responderAdds(EMPTY_SLOTS, '#1')
    expect(server).toEqual({ previous: null, current: null, next: '#1' })
    expect(receivedWith(server, '#1')).toEqual({ previous: null, current: '#1', next: null })
  })

  it('鍵の更新: 古い鍵の組は previous に残り、まだ受け取れる', () => {
    const laptop = initiatorAdds({ previous: null, current: '#1', next: null }, '#2')
    expect(laptop).toEqual({ previous: '#1', current: '#2', next: null })
    expect(canReceive(laptop, '#1')).toBe(true)
    const server = responderAdds({ previous: '#0', current: '#1', next: null }, '#2')
    // 応じた側は previous を捨てる
    expect(server).toEqual({ previous: null, current: '#1', next: '#2' })
    expect(receivedWith(server, '#2')).toEqual({ previous: '#1', current: '#2', next: null })
  })

  it('確認を待つ next があるときに自分で始めると、next を previous にする', () => {
    expect(initiatorAdds({ previous: '#0', current: '#1', next: '#2' }, '#3')).toEqual({
      previous: '#2',
      current: '#3',
      next: null,
    })
  })

  it('current の鍵の組で受け取っても変わらない', () => {
    const slots = { previous: null, current: '#1', next: null }
    expect(receivedWith(slots, '#1')).toBe(slots)
  })
})
