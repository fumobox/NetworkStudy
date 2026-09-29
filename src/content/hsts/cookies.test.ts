// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cookieHeader, cookiesToSend, type StoredCookie } from './cookies'

// RFC 6265 §3.1 の例: SID は Secure でホストだけ、lang は Domain=example.com
const JAR: StoredCookie[] = [
  { name: 'SID', value: '31d4d96e407aad42', domain: 'example.com', hostOnly: true, secure: true },
  { name: 'lang', value: 'en-US', domain: 'example.com', hostOnly: false, secure: false },
]

describe('要求に付ける Cookie（RFC 6265 §5.4）', () => {
  it('http では Secure の Cookie を付けない', () => {
    expect(cookieHeader(cookiesToSend(JAR, { host: 'example.com', secure: false }))).toBe(
      'lang=en-US',
    )
    expect(cookieHeader(cookiesToSend(JAR, { host: 'example.com', secure: true }))).toBe(
      'SID=31d4d96e407aad42; lang=en-US',
    )
  })

  it('ホストだけの Cookie はサブドメインに付かず、Domain のある Cookie は付く', () => {
    expect(cookieHeader(cookiesToSend(JAR, { host: 'www.example.com', secure: true }))).toBe(
      'lang=en-US',
    )
    expect(
      cookieHeader(cookiesToSend(JAR, { host: 'notexample.com', secure: true })),
    ).toBeUndefined()
  })
})
