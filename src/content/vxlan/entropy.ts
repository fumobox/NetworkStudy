/**
 * 外側の UDP の送信元ポート（RFC 7348 §5）。内側のパケットのフィールドのハッシュから作ると、外側のヘッダーでハッシュする
 * ルーターが、流れごとに等コストの経路（ECMP、RFC 2992）へ振り分けられる。範囲は 49152〜65535 が推奨（RFC 6335）。
 *
 * ハッシュの関数は決まっていない。ここでは説明のため、FNV-1a（32 ビット）を使う。Linux は自分の流れのハッシュを使い、
 * srcport を指定しなければ ip_local_port_range（既定 32768〜60999）から選ぶ。どちらも「例の値」として扱う
 */

export interface FlowTuple {
  readonly proto: string
  readonly srcIp: string
  readonly srcPort: number
  readonly dstIp: string
  readonly dstPort: number
}

/** FNV-1a（32 ビット）。説明用のハッシュ */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function flowKey(flow: FlowTuple): string {
  return `${flow.proto} ${flow.srcIp}:${String(flow.srcPort)} ${flow.dstIp}:${String(flow.dstPort)}`
}

export const SOURCE_PORT_MIN = 49152
export const SOURCE_PORT_MAX = 65535

/** 内側の流れから、外側の UDP の送信元ポートを選ぶ */
export function sourcePort(inner: FlowTuple): number {
  const span = SOURCE_PORT_MAX - SOURCE_PORT_MIN + 1
  return SOURCE_PORT_MIN + (fnv1a(flowKey(inner)) % span)
}

/** 外側の 5 つ組のハッシュで、等コストの経路の何番目を使うか */
export function ecmpIndex(outer: FlowTuple, paths: number): number {
  return fnv1a(flowKey(outer)) % paths
}
