/** 転送の表（FIB）を最長一致で引く。プレフィックスの解析と一致の判定は、経路の検索のテーマのものを使う */
import { parsePrefix, routeMatches } from '../route-lookup/routing'
import { parseIPv4 } from '../subnet-calculator/subnet'

export interface FibEntry {
  readonly prefix: string
  readonly nextHop: string
  readonly via: string
}

export function lookupFib(fib: readonly FibEntry[], address: string): FibEntry | null {
  const value = parseIPv4(address)
  if (value === null) {
    throw new Error(`IPv4 のアドレスが不正: ${address}`)
  }
  let best: { entry: FibEntry; length: number } | null = null
  for (const entry of fib) {
    const prefix = parsePrefix(entry.prefix)
    if (prefix === null) {
      throw new Error(`プレフィックスが不正: ${entry.prefix}`)
    }
    if (routeMatches(prefix, value) && (best === null || prefix.length > best.length)) {
      best = { entry, length: prefix.length }
    }
  }
  return best?.entry ?? null
}
