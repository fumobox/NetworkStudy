// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { containsLoop, formatAsPath, prepend } from './asPath'

describe('AS_PATH（RFC 4271 §5.1.2、§9.1.2）', () => {
  it('eBGP で広告するときは自分の AS 番号を左端に付け足す', () => {
    expect(formatAsPath(prepend([64511], 64500))).toBe('64500 64511')
  })

  it('プリペンドでは同じ AS 番号をいくつも付け足せる', () => {
    expect(formatAsPath(prepend([64511], 64511, 2))).toBe('64511 64511 64511')
  })

  it('自分の AS 番号があればループ', () => {
    expect(containsLoop([64500, 64511], 64511)).toBe(true)
    expect(containsLoop([64500, 64511], 64496)).toBe(false)
  })
})
