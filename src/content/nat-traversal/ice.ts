/** ICE の候補と候補ペアの優先度（RFC 8445 §5.1.2.1、§6.1.2.3）と、SDP の candidate の行（RFC 8839 §5.1） */

/** 種類の優先度の推奨値（RFC 8445 §5.1.2.2） */
export const TYPE_PREFERENCE = { host: 126, prflx: 110, srflx: 100, relay: 0 } as const
export type CandidateType = keyof typeof TYPE_PREFERENCE

/** priority = 2^24 × 種類の優先度 + 2^8 × ローカルの優先度 + (256 − コンポーネント ID) */
export function candidatePriority(
  typePreference: number,
  localPreference: number,
  componentId: number,
): number {
  return typePreference * 2 ** 24 + localPreference * 2 ** 8 + (256 - componentId)
}

/** このページの候補の優先度（IP アドレスは 1 つなのでローカルの優先度は 65535、コンポーネントは 1 つ） */
export function priorityOf(type: CandidateType): number {
  return candidatePriority(TYPE_PREFERENCE[type], 65535, 1)
}

/**
 * 候補ペアの優先度 = 2^32 × MIN(G, D) + 2 × MAX(G, D) + (G > D ? 1 : 0)。G は制御する側（controlling）の候補の優先度。
 * 2^53 を超えるので BigInt で計算する
 */
export function pairPriority(controlling: number, controlled: number): bigint {
  const g = BigInt(controlling)
  const d = BigInt(controlled)
  const min = g < d ? g : d
  const max = g < d ? d : g
  return 2n ** 32n * min + 2n * max + (g > d ? 1n : 0n)
}

export interface SdpCandidate {
  readonly foundation: string
  readonly type: CandidateType
  readonly ip: string
  readonly port: number
  readonly related?: { readonly ip: string; readonly port: number }
}

/** a=candidate の行（コンポーネント 1、UDP） */
export function sdpCandidate(candidate: SdpCandidate): string {
  const base = `a=candidate:${candidate.foundation} 1 UDP ${String(priorityOf(candidate.type))} ${candidate.ip} ${String(candidate.port)} typ ${candidate.type}`
  return candidate.related === undefined
    ? base
    : `${base} raddr ${candidate.related.ip} rport ${String(candidate.related.port)}`
}
