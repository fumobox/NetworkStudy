/**
 * 暗号鍵ルーティング（cryptokey routing。ホワイトペーパー §2、§3、Linux の drivers/net/wireguard/allowedips.c）。
 *
 * 各ピアは公開鍵と AllowedIPs（アドレスの範囲の一覧）を持つ。
 * - 送るとき: 宛先を AllowedIPs で最長一致で引き、見つかったピアの鍵で暗号化する。どのピアにも当たらなければ捨てる
 *   （ホワイトペーパー §3: ICMP の「no route to host」で送った側に知らせる）
 * - 受け取ったとき: 復号した内側の送信元を同じく最長一致で引き、その結果が送ってきたピアと同じときだけ受け入れる
 *   （「送ってきたピアの範囲に入っているか」ではない。より長い一致が別のピアのものなら捨てる）
 * - 同じ範囲を別のピアに足すと、その範囲は新しいピアに移る
 */
import { parsePrefix, routeMatches } from '../route-lookup/routing'
import { parseIPv4 } from '../subnet-calculator/subnet'

export interface AllowedIp {
  readonly prefix: string
  readonly peer: string
}

function parsed(entry: AllowedIp) {
  const prefix = parsePrefix(entry.prefix)
  if (prefix === null) {
    throw new Error(`AllowedIPs の範囲が不正: ${entry.prefix}`)
  }
  return prefix
}

/** 最長一致で、アドレスを持つピアを引く */
export function lookupPeer(table: readonly AllowedIp[], address: string): AllowedIp | null {
  const value = parseIPv4(address)
  if (value === null) {
    throw new Error(`IPv4 のアドレスが不正: ${address}`)
  }
  let best: { entry: AllowedIp; length: number } | null = null
  for (const entry of table) {
    const prefix = parsed(entry)
    if (routeMatches(prefix, value) && (best === null || prefix.length > best.length)) {
      best = { entry, length: prefix.length }
    }
  }
  return best?.entry ?? null
}

/** 送るときに使うピア。null ならどのピアにも送らない */
export function outboundPeer(table: readonly AllowedIp[], destination: string): string | null {
  return lookupPeer(table, destination)?.peer ?? null
}

/** 受け取ったパケットの内側の送信元が、送ってきたピアのものか */
export function inboundAllowed(
  table: readonly AllowedIp[],
  fromPeer: string,
  source: string,
): boolean {
  return lookupPeer(table, source)?.peer === fromPeer
}

/** 範囲を足す。すでにほかのピアが持っていれば、新しいピアに移す */
export function addAllowedIp(table: readonly AllowedIp[], entry: AllowedIp): readonly AllowedIp[] {
  const key = parsed(entry)
  const rest = table.filter((existing) => {
    const other = parsed(existing)
    return other.network !== key.network || other.length !== key.length
  })
  return [...rest, entry]
}
