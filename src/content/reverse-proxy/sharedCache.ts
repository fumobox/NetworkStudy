/**
 * プロキシの共有キャッシュの判断（RFC 9111）
 *
 * - §3（保存してよい条件）: no-store なら保存しない。共有キャッシュは private の応答を保存しない
 * - §3.5: 共有キャッシュは Authorization の付いた要求への応答を、must-revalidate、public、s-maxage のどれかがなければ
 *   使い回さない
 * - §4.2.1: 共有キャッシュでは s-maxage が max-age より優先する（プライベートキャッシュは s-maxage を無視する）
 * - §5.1（Age）、§5.2.2.7（private）、§5.2.2.10（s-maxage。proxy-revalidate も意味する）
 * ここで扱うのは、このページで使うディレクティブだけ
 */

export interface CacheControl {
  readonly maxAge?: number
  readonly sMaxage?: number
  readonly private?: boolean
  readonly public?: boolean
  readonly mustRevalidate?: boolean
  readonly noStore?: boolean
}

export function parseCacheControl(value: string): CacheControl {
  const directives = new Map(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== '')
      .map((part) => {
        const [name = '', argument] = part.split('=')
        return [name, argument] as const
      }),
  )
  const seconds = (name: string) => {
    const argument = directives.get(name)
    return argument === undefined ? undefined : Number.parseInt(argument, 10)
  }
  const maxAge = seconds('max-age')
  const sMaxage = seconds('s-maxage')
  return {
    ...(maxAge === undefined ? {} : { maxAge }),
    ...(sMaxage === undefined ? {} : { sMaxage }),
    ...(directives.has('private') ? { private: true } : {}),
    ...(directives.has('public') ? { public: true } : {}),
    ...(directives.has('must-revalidate') ? { mustRevalidate: true } : {}),
    ...(directives.has('no-store') ? { noStore: true } : {}),
  }
}

/** 新しいとみなせる時間（秒）。共有キャッシュだけが s-maxage を使う */
export function freshnessLifetime(cc: CacheControl, shared: boolean): number | undefined {
  return shared && cc.sMaxage !== undefined ? cc.sMaxage : cc.maxAge
}

export function mayStore(options: {
  readonly shared: boolean
  readonly requestHasAuthorization: boolean
  readonly cc: CacheControl
}): boolean {
  const { shared, requestHasAuthorization, cc } = options
  if (cc.noStore === true) {
    return false
  }
  if (shared && cc.private === true) {
    return false
  }
  if (shared && requestHasAuthorization) {
    return cc.mustRevalidate === true || cc.public === true || cc.sMaxage !== undefined
  }
  return true
}

/** 残りの新しさ（秒）。Cache-Status の ttl */
export const remainingTtl = (lifetime: number, age: number): number => lifetime - age
