/**
 * 時間で切れる NAT の UDP の対応（RFC 4787 §4.1 の endpoint-independent mapping、§4.3）。
 * REQ-5 は対応を 2 分より短く切ってはならないとするが、実際には短い機器もある。このテーマの 30 秒はそうした機器の例。
 * 外へ出るパケットは対応の時間を延ばす（REQ-6）。切れた後に外へ出ると、新しいポートを選ぶ
 */

export interface NatMapping {
  readonly internal: string
  readonly external: string
  readonly remote: string
  readonly lastUsed: number
}

export interface TimedNat {
  readonly publicIp: string
  readonly timeout: number
  readonly nextPort: number
  readonly mappings: readonly NatMapping[]
}

export function createNat(publicIp: string, firstPort: number, timeout: number): TimedNat {
  return { publicIp, timeout, nextPort: firstPort, mappings: [] }
}

const alive = (nat: TimedNat, now: number) =>
  nat.mappings.filter((mapping) => now - mapping.lastUsed < nat.timeout)

/** 外へ出るパケット。対応がなければ作り、あれば時間を延ばす */
export function outbound(
  nat: TimedNat,
  internal: string,
  remote: string,
  now: number,
): { readonly nat: TimedNat; readonly external: string; readonly created: boolean } {
  const live = alive(nat, now)
  const existing = live.find((mapping) => mapping.internal === internal)
  if (existing !== undefined) {
    const refreshed = { ...existing, lastUsed: now, remote }
    return {
      nat: { ...nat, mappings: live.map((m) => (m === existing ? refreshed : m)) },
      external: existing.external,
      created: false,
    }
  }
  const external = `${nat.publicIp}:${String(nat.nextPort)}`
  return {
    nat: {
      ...nat,
      nextPort: nat.nextPort + 1,
      mappings: [...live, { internal, external, remote, lastUsed: now }],
    },
    external,
    created: true,
  }
}

/** 外から来たパケット。対応がなければ null（捨てる） */
export function inbound(nat: TimedNat, external: string, now: number): string | null {
  return alive(nat, now).find((mapping) => mapping.external === external)?.internal ?? null
}

export const NAT_COLUMNS = ['Proto', 'Internal', 'External', 'Remote'] as const

export function natRows(nat: TimedNat, now: number): readonly (readonly string[])[] {
  return alive(nat, now).map((mapping) => [
    'UDP',
    mapping.internal,
    mapping.external,
    mapping.remote,
  ])
}
