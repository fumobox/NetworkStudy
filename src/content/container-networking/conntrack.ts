/**
 * Linux の接続の追跡（conntrack）と NAT。
 *
 * 根拠:
 * - nftables wiki「Performing Network Address Translation (NAT)」: NAT の規則を見るのは接続の最初のパケットだけで、
 *   以降のパケットは接続の追跡の記録で変換する。masquerade は出ていくインターフェースのアドレスに送信元を書き換える
 * - iptables-extensions(8): conntrack の状態、DNAT は PREROUTING（と OUTPUT）で使う
 * - RFC 3022 §2.2（NAPT）
 * - Linux の net/netfilter/nf_conntrack_proto_tcp.c の状態の名前（SYN_SENT、SYN_RECV、ESTABLISHED、CLOSE）
 *
 * 記録は「元の向き（original）」と「返事の向き（reply）」の 2 つの組を持つ。NAT は、この 2 つの組の違いとして表れる。
 * 変換しない接続では、reply は original を逆にしたもの。
 *
 * 送信元のポートは、変換後の reply の組がほかの記録と重ならなければそのまま使う（Linux の nf_nat_core.c の get_unique_tuple）。
 * 重なるときに Linux がどのポートを選ぶかは決まっていない。このページでは、次の番号から空いているものを選ぶ（例の値）
 */

export interface Endpoint {
  readonly ip: string
  readonly port: number
}

export interface Tuple {
  readonly src: Endpoint
  readonly dst: Endpoint
}

export type ConntrackState = 'SYN_SENT' | 'SYN_RECV' | 'ESTABLISHED' | 'CLOSE'

export interface ConntrackEntry {
  readonly original: Tuple
  readonly reply: Tuple
  readonly state: ConntrackState
}

export type Direction = 'original' | 'reply'

export type TcpFlags = 'SYN' | 'SYN, ACK' | 'ACK' | 'RST, ACK'

const sameEndpoint = (a: Endpoint, b: Endpoint) => a.ip === b.ip && a.port === b.port
const sameTuple = (a: Tuple, b: Tuple) => sameEndpoint(a.src, b.src) && sameEndpoint(a.dst, b.dst)

export function invert(tuple: Tuple): Tuple {
  return { src: tuple.dst, dst: tuple.src }
}

/** 変換しない接続（reply は original の逆） */
export function untranslated(original: Tuple): ConntrackEntry {
  return { original, reply: invert(original), state: 'SYN_SENT' }
}

/** 送信元を outIp に書き換える（MASQUERADE）。ポートは、reply の組が重ならなければそのまま */
export function masquerade(
  entries: readonly ConntrackEntry[],
  original: Tuple,
  outIp: string,
): ConntrackEntry {
  const replyFor = (port: number): Tuple => ({ src: original.dst, dst: { ip: outIp, port } })
  let port = original.src.port
  while (entries.some((entry) => sameTuple(entry.reply, replyFor(port)))) {
    port += 1
  }
  return { original, reply: replyFor(port), state: 'SYN_SENT' }
}

/** 宛先を to に書き換える（DNAT）。送信元は変えないので、返事は to から元の送信元へ向かう */
export function dnat(original: Tuple, to: Endpoint): ConntrackEntry {
  return { original, reply: { src: to, dst: original.src }, state: 'SYN_SENT' }
}

export interface ConntrackMatch {
  readonly entry: ConntrackEntry
  readonly direction: Direction
}

/** パケットの組が、どの記録のどちらの向きに当たるか */
export function match(entries: readonly ConntrackEntry[], packet: Tuple): ConntrackMatch | null {
  for (const entry of entries) {
    if (sameTuple(entry.original, packet)) {
      return { entry, direction: 'original' }
    }
    if (sameTuple(entry.reply, packet)) {
      return { entry, direction: 'reply' }
    }
  }
  return null
}

/**
 * 変換した後の組。元の向きのパケットは reply の逆に、返事の向きのパケットは original の逆になる
 * （変換しない記録では、どちらも受け取った組のまま）
 */
export function translate(found: ConntrackMatch): Tuple {
  return found.direction === 'original' ? invert(found.entry.reply) : invert(found.entry.original)
}

/** TCP の状態の移り変わり（ハンドシェイクと RST だけ） */
export function nextState(
  state: ConntrackState,
  flags: TcpFlags,
  direction: Direction,
): ConntrackState {
  if (flags === 'RST, ACK') {
    return 'CLOSE'
  }
  if (flags === 'SYN, ACK' && direction === 'reply' && state === 'SYN_SENT') {
    return 'SYN_RECV'
  }
  if (flags === 'ACK' && direction === 'original' && state === 'SYN_RECV') {
    return 'ESTABLISHED'
  }
  return state
}

export function formatEndpoint(endpoint: Endpoint): string {
  return `${endpoint.ip}:${String(endpoint.port)}`
}

export function formatTuple(tuple: Tuple): string {
  return `${formatEndpoint(tuple.src)} → ${formatEndpoint(tuple.dst)}`
}

export const CONNTRACK_COLUMNS = ['Proto', 'Original', 'Reply', 'State'] as const

export function conntrackRow(entry: ConntrackEntry): readonly string[] {
  return ['TCP', formatTuple(entry.original), formatTuple(entry.reply), entry.state]
}
