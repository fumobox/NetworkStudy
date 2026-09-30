/**
 * 最良経路の選び方（RFC 4271 §9.1）を、このテーマで要る部分だけにしたもの。
 * 自分の AS がある経路は除く（§9.1.2）。ローカルな方針（LOCAL_PREF）は使わず、どれも eBGP で ORIGIN は IGP、
 * 隣の AS はそれぞれ違うので MED も比べない。残る基準は §9.1.2.2 の a)（AS_PATH の AS が少ない）と、
 * 同じときの f)（BGP Identifier が小さい）
 */
import { containsLoop, type AsPath } from './asPath'

export interface Candidate {
  readonly from: string
  /** 送ってきた相手の BGP Identifier（IPv4 アドレスの形） */
  readonly peerId: string
  readonly asPath: AsPath
  readonly nextHop: string
}

export type BestReason = 'only' | 'asPathLength' | 'bgpIdentifier'

export interface BestPath {
  readonly best: Candidate
  readonly reason: BestReason
}

const idValue = (id: string): number =>
  id.split('.').reduce((total, octet) => total * 256 + Number(octet), 0)

export function selectBest(candidates: readonly Candidate[], localAs: number): BestPath | null {
  const usable = candidates.filter((c) => !containsLoop(c.asPath, localAs))
  const [first, ...rest] = [...usable].sort(
    (a, b) => a.asPath.length - b.asPath.length || idValue(a.peerId) - idValue(b.peerId),
  )
  if (first === undefined) {
    return null
  }
  const second = rest[0]
  if (second === undefined) {
    return { best: first, reason: 'only' }
  }
  return {
    best: first,
    reason: first.asPath.length < second.asPath.length ? 'asPathLength' : 'bgpIdentifier',
  }
}

/** 同じ相手からの同じプレフィックスの新しい経路は、古いものに置き換わる（暗黙の取り下げ。§3.1、§9） */
export const replaceFrom = (
  candidates: readonly Candidate[],
  update: Candidate,
): readonly Candidate[] => [...candidates.filter((c) => c.from !== update.from), update]

/** 取り下げ、またはセッションが切れたときは、その相手からの経路を消す（§3.1） */
export const removeFrom = (candidates: readonly Candidate[], from: string): readonly Candidate[] =>
  candidates.filter((c) => c.from !== from)
