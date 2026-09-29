/**
 * 要求に付ける Cookie（RFC 6265 §5.4 手順 1）
 *
 * - host-only の Cookie は、設定したホストそのものにだけ付く。Domain 属性のある Cookie は、そのドメインとサブドメインに付く
 *   （§5.1.3 のドメインの一致）
 * - secure-only の Cookie（Secure 属性）は、安全な接続（https）の要求にだけ付く（§4.1.2.5）
 */

export interface StoredCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly hostOnly: boolean
  readonly secure: boolean
}

const domainMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

export interface CookieRequest {
  readonly host: string
  /** https の要求か */
  readonly secure: boolean
}

export function cookiesToSend(
  jar: readonly StoredCookie[],
  request: CookieRequest,
): StoredCookie[] {
  const host = request.host.toLowerCase()
  return jar.filter(
    (cookie) =>
      (cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain)) &&
      (!cookie.secure || request.secure),
  )
}

/** Cookie ヘッダーの値。付けるものがなければ undefined */
export function cookieHeader(cookies: readonly StoredCookie[]): string | undefined {
  return cookies.length === 0 ? undefined : cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}
