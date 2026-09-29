// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addSeconds,
  isExpired,
  matchKnownHost,
  noteHeader,
  upgradeUri,
  type KnownHost,
} from './store'

const NOW = '2026-10-01T09:00:00Z'
const entry = (
  host: string,
  includeSubDomains: boolean,
  expires: string | null = '2027-01-01T00:00:00Z',
): KnownHost => ({
  host,
  includeSubDomains,
  expires,
  source: expires === null ? 'preload' : 'header',
})

describe('期限', () => {
  it('max-age の秒を足す', () => {
    expect(addSeconds('2026-06-01T09:00:00Z', 31536000)).toBe('2027-06-01T09:00:00Z')
    expect(addSeconds('2025-09-01T09:00:00Z', 31536000)).toBe('2026-09-01T09:00:00Z')
    expect(addSeconds(NOW, 31536000)).toBe('2027-10-01T09:00:00Z')
  })

  it('期限が過去なら期限切れ。ちょうど今はまだ切れていない（§8.1.1）', () => {
    expect(isExpired(entry('example.com', false, '2026-09-01T09:00:00Z'), NOW)).toBe(true)
    expect(isExpired(entry('example.com', false, NOW), NOW)).toBe(false)
    expect(isExpired(entry('example.com', false, null), NOW)).toBe(false)
  })
})

describe('照合（§8.2、§8.3）', () => {
  it('§8.2 の例: 上位ドメインとの一致と完全一致', () => {
    const store = [entry('bar.foo.example.com', true), entry('foo.example.com', true)]
    expect(matchKnownHost(store, 'qaz.bar.foo.example.com', NOW).kind).toBe('superdomain')
    expect(matchKnownHost([entry('foo.example.com', false)], 'foo.example.com', NOW).kind).toBe(
      'congruent',
    )
  })

  it('ラベルで比べ、大文字小文字を区別しない。includeSubDomains がなければサブドメインは一致しない', () => {
    const store = [entry('example.com', false)]
    expect(matchKnownHost(store, 'notexample.com', NOW).kind).toBe('none')
    expect(matchKnownHost(store, 'EXAMPLE.com', NOW).kind).toBe('congruent')
    expect(matchKnownHost(store, 'www.example.com', NOW).kind).toBe('none')
  })

  it('期限切れの記録と IP アドレスは一致しない', () => {
    expect(
      matchKnownHost([entry('example.com', true, '2026-09-01T09:00:00Z')], 'example.com', NOW).kind,
    ).toBe('none')
    expect(matchKnownHost([entry('192.0.2.10', false)], '192.0.2.10', NOW).kind).toBe('none')
  })
})

describe('記録（§8.1、§8.1.1）', () => {
  const secure = { secure: true, transportOk: true, now: NOW }

  it('平文や誤りのある接続で受けたヘッダーは無視する', () => {
    expect(
      noteHeader([], { ...secure, host: 'example.com', headers: ['max-age=1'], secure: false }),
    ).toEqual([])
    expect(
      noteHeader([], {
        ...secure,
        host: 'example.com',
        headers: ['max-age=1'],
        transportOk: false,
      }),
    ).toEqual([])
  })

  it('最初のヘッダーだけを処理し、不正なヘッダーは無視する', () => {
    expect(
      noteHeader([], { ...secure, host: 'example.com', headers: ['max-age=60', 'max-age=0'] })[0]
        ?.expires,
    ).toBe('2026-10-01T09:01:00Z')
    expect(
      noteHeader([], { ...secure, host: 'example.com', headers: ['includeSubDomains'] }),
    ).toEqual([])
  })

  it('max-age=0 は記録を消し、知らないホストは記録しない', () => {
    expect(
      noteHeader([entry('example.com', true)], {
        ...secure,
        host: 'example.com',
        headers: ['max-age=0'],
      }),
    ).toEqual([])
    expect(noteHeader([], { ...secure, host: 'example.com', headers: ['max-age=0'] })).toEqual([])
  })

  it('プリロードの項目は変えず、ヘッダーの記録だけを差し替える・消す', () => {
    const preload = entry('example.com', true, null)
    const once = noteHeader([preload], { ...secure, host: 'example.com', headers: ['max-age=60'] })
    const twice = noteHeader(once, { ...secure, host: 'example.com', headers: ['max-age=120'] })
    expect(twice).toEqual([
      preload,
      {
        host: 'example.com',
        includeSubDomains: false,
        expires: '2026-10-01T09:02:00Z',
        source: 'header',
      },
    ])
    expect(noteHeader(twice, { ...secure, host: 'example.com', headers: ['max-age=0'] })).toEqual([
      preload,
    ])
  })

  it('とても大きな max-age でも壊れない', () => {
    expect(() => addSeconds(NOW, Number.MAX_SAFE_INTEGER)).not.toThrow()
  })

  it('IP アドレスは記録しない。上位ドメインの記録は変えずに、自分の記録を足す', () => {
    expect(noteHeader([], { ...secure, host: '192.0.2.10', headers: ['max-age=1'] })).toEqual([])
    const parent = entry('example.com', true)
    const next = noteHeader([parent], {
      ...secure,
      host: 'www.example.com',
      headers: ['max-age=31536000'],
    })
    expect(next).toEqual([
      parent,
      {
        host: 'www.example.com',
        includeSubDomains: false,
        expires: '2027-10-01T09:00:00Z',
        source: 'header',
      },
    ])
  })
})

describe('https への書き換え（§8.3 手順 5）', () => {
  it('ポート 80 は 443 に、ほかは残し、なければ足さない', () => {
    expect(upgradeUri('http://example.com/')).toBe('https://example.com/')
    expect(upgradeUri('http://example.com:80/x')).toBe('https://example.com:443/x')
    expect(upgradeUri('http://example.com:8080/x')).toBe('https://example.com:8080/x')
  })
})
