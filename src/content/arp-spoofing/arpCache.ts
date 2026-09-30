/**
 * ARP キャッシュの更新（RFC 826 の「Packet Reception」）。
 *
 * RFC 826: 送信元の IP アドレス（SPA）がもう表にあれば、要求か応答かを見る前に、その行の MAC アドレスを SHA で書き換える
 * （merge）。自分が対象（TPA が自分）で、まだ行がなければ加える。応答が自分の要求への答えかどうかは確かめない。
 * 静的なエントリーは RFC 826 にはなく、OS の機能（書き換えない）
 */

export const CACHE_COLUMNS = ['IP', 'MAC', 'Type'] as const

export type EntryType = 'dynamic' | 'static'

export interface ArpEntry {
  readonly ip: string
  readonly mac: string
  readonly type: EntryType
}

export interface ArpPacket {
  /** 1 = request、2 = reply */
  readonly oper: 1 | 2
  readonly sha: string
  readonly spa: string
  readonly tha: string
  readonly tpa: string
}

export type CacheAction = 'updated' | 'refreshed' | 'added' | 'static' | 'notTarget'

export interface CacheResult {
  readonly cache: readonly ArpEntry[]
  readonly action: CacheAction
}

/** ARP のパケットを 1 つ受け取ったときの、ARP キャッシュの変化（RFC 826） */
export function applyArpPacket(
  cache: readonly ArpEntry[],
  packet: ArpPacket,
  myIp: string,
): CacheResult {
  const existing = cache.find((entry) => entry.ip === packet.spa)
  if (existing !== undefined) {
    if (existing.type === 'static') {
      return { cache, action: 'static' }
    }
    if (existing.mac === packet.sha) {
      return { cache, action: 'refreshed' }
    }
    return {
      cache: cache.map((entry) => (entry === existing ? { ...entry, mac: packet.sha } : entry)),
      action: 'updated',
    }
  }
  if (packet.tpa !== myIp) {
    return { cache, action: 'notTarget' }
  }
  return {
    cache: [...cache, { ip: packet.spa, mac: packet.sha, type: 'dynamic' }],
    action: 'added',
  }
}
