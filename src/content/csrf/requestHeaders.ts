/**
 * ブラウザーが付ける Origin と Sec-Fetch-Site
 *
 * - Fetch Standard（WHATWG）"append a request `Origin` header": オリジンをまたぐ CORS の要求（response tainting が cors）には必ず付く。それ以外では GET・HEAD でない要求にだけ付き、
 *   ナビゲーション（フォームの送信など）でも付く。リファラーポリシーが no-referrer なら値は null、
 *   strict-origin-when-cross-origin（既定）なら https のページから https でない宛先への要求のときだけ null
 * - Fetch Metadata Request Headers（W3C Working Draft）§2.3: Sec-Fetch-Site は none（利用者がアドレスを入力したなど）、
 *   same-origin、same-site、cross-site。リダイレクトを含む URL の並びを順に見て決める。§3: 宛先が https のような potentially trustworthy な URL のときだけ付く
 * - 要求を拒むかどうかの方針（isolationPolicy）は標準ではなく、このページの例（OWASP の CSRF 対策の指針と同じ考え方）
 */
import { isSafeMethod } from './cookies'
import { sameOrigin, sameSite, serializeOrigin, type WebOrigin } from './site'

export type RequestMode = 'navigate' | 'cors'
export type ReferrerPolicy = 'no-referrer' | 'strict-origin-when-cross-origin' | 'same-origin'

export interface OriginInput {
  readonly method: string
  readonly mode: RequestMode
  readonly initiator: WebOrigin
  readonly target: WebOrigin
  readonly referrerPolicy?: ReferrerPolicy
}

/** Origin ヘッダーの値。付かなければ undefined */
export function originHeader(input: OriginInput): string | undefined {
  const { method, mode, initiator, target } = input
  const serialized = serializeOrigin(initiator)
  if (mode === 'cors' && !sameOrigin(initiator, target)) {
    return serialized
  }
  if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') {
    return undefined
  }
  switch (input.referrerPolicy ?? 'strict-origin-when-cross-origin') {
    case 'no-referrer':
      return 'null'
    case 'strict-origin-when-cross-origin':
      return initiator.scheme === 'https' && target.scheme !== 'https' ? 'null' : serialized
    case 'same-origin':
      return sameOrigin(initiator, target) ? serialized : 'null'
  }
}

export type FetchSite = 'none' | 'same-origin' | 'same-site' | 'cross-site'

/** Sec-Fetch-Site。initiator が 'user' なら、利用者が直接始めたナビゲーション */
export function secFetchSite(
  initiator: WebOrigin | 'user',
  urlList: readonly WebOrigin[],
): FetchSite {
  if (initiator === 'user') {
    return 'none'
  }
  let value: FetchSite = 'same-origin'
  for (const url of urlList) {
    if (sameOrigin(url, initiator)) {
      continue
    }
    if (!sameSite(initiator, url)) {
      return 'cross-site'
    }
    value = 'same-site'
  }
  return value
}

export interface IsolationInput {
  /** Sec-Fetch-Site。古いブラウザーや https でない宛先では付かない */
  readonly site: FetchSite | undefined
  readonly mode: RequestMode
  readonly method: string
  readonly origin: string | undefined
  /** このサイト自身のオリジン */
  readonly allowedOrigin: string
}

/**
 * 例の方針: same-origin と none は通す。same-site と cross-site は、安全なメソッドのナビゲーション（リンク）だけ通す。
 * Sec-Fetch-Site がなければ、安全でないメソッドは Origin が自分のオリジンのときだけ通す
 */
export function isolationPolicy(input: IsolationInput): 'allow' | 'deny' {
  const safe = isSafeMethod(input.method)
  if (input.site === undefined) {
    return safe || input.origin === input.allowedOrigin ? 'allow' : 'deny'
  }
  if (input.site === 'same-origin' || input.site === 'none') {
    return 'allow'
  }
  return input.mode === 'navigate' && safe ? 'allow' : 'deny'
}
