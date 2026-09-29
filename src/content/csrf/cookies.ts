/**
 * Cookie の SameSite の扱い（draft-ietf-httpbis-rfc6265bis-22。RFC 6265 を置き換える予定の草案で、2026 年 9 月の時点で RFC ではない）
 *
 * - §4.1.1（Set-Cookie の形。属性の順は決まっていない）、§5.6.7（SameSite の値は大文字小文字を区別せず Strict・Lax・None。
 *   それ以外や未指定は Default）、§5.7 手順 17（same-site-flag）・手順 19（None は Secure がなければ捨てる）
 * - §5.8.3 手順 3: same-site-flag が None でなく、要求がサイトをまたぐなら、次のすべてを満たすときだけ付ける:
 *   HTTP の要求で、flag が Lax か Default で、メソッドが安全で、行き先がトップレベルのナビゲーション
 * - §5.6.7.2: Lax-allowing-unsafe（ブラウザーの互換のための措置）は Default の Cookie だけに、作られてから短い間
 *   （2 分以下が目安）だけ使ってよく、そのあいだは安全でないメソッドでも付ける
 * - RFC 9110 §9.2.1: 安全なメソッドは GET、HEAD、OPTIONS、TRACE
 */

export type SameSiteFlag = 'Strict' | 'Lax' | 'None' | 'Default'

export function sameSiteFlag(attribute: string | undefined): SameSiteFlag {
  switch (attribute?.toLowerCase()) {
    case 'strict':
      return 'Strict'
    case 'lax':
      return 'Lax'
    case 'none':
      return 'None'
    default:
      return 'Default'
  }
}

/** None の Cookie は Secure がなければ保存されない（§5.7 手順 19） */
export const acceptsSetCookie = (flag: SameSiteFlag, secure: boolean): boolean =>
  flag !== 'None' || secure

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'TRACE'] as const
export const isSafeMethod = (method: string): boolean =>
  SAFE_METHODS.some((safe) => safe === method.toUpperCase())

export interface SetCookieSpec {
  readonly name: string
  readonly value: string
  readonly path?: string
  readonly secure?: boolean
  readonly httpOnly?: boolean
  readonly sameSite?: 'Strict' | 'Lax' | 'None'
}

/** Set-Cookie の値（このページでは Path、Secure、HttpOnly、SameSite の順に並べる） */
export function formatSetCookie(spec: SetCookieSpec): string {
  return [
    `${spec.name}=${spec.value}`,
    ...(spec.path === undefined ? [] : [`Path=${spec.path}`]),
    ...(spec.secure === true ? ['Secure'] : []),
    ...(spec.httpOnly === true ? ['HttpOnly'] : []),
    ...(spec.sameSite === undefined ? [] : [`SameSite=${spec.sameSite}`]),
  ].join('; ')
}

export interface AttachInput {
  readonly flag: SameSiteFlag
  /** 要求が同じサイトから始まったか（§5.2） */
  readonly sameSiteRequest: boolean
  readonly method: string
  /** トップレベルのナビゲーションか（iframe や fetch() ではない） */
  readonly topLevel: boolean
  /** Lax-allowing-unsafe を使うブラウザーなら、Cookie の年齢と上限（ミリ秒） */
  readonly laxAllowingUnsafe?: { readonly ageMs: number; readonly limitMs: number }
}

export type AttachDecision = 'sent' | 'withheld'

export function attachDecision(input: AttachInput): AttachDecision {
  const { flag, sameSiteRequest, method, topLevel, laxAllowingUnsafe } = input
  if (flag === 'None' || sameSiteRequest) {
    return 'sent'
  }
  if (flag === 'Strict' || !topLevel) {
    return 'withheld'
  }
  const unsafeAllowed =
    flag === 'Default' &&
    laxAllowingUnsafe !== undefined &&
    laxAllowingUnsafe.ageMs <= laxAllowingUnsafe.limitMs
  return isSafeMethod(method) || unsafeAllowed ? 'sent' : 'withheld'
}
