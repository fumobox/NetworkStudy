/**
 * スイッチの Dynamic ARP Inspection（DAI）の判断。標準ではなく、Cisco の IOS XE の文書
 * （Catalyst 9300 Security Configuration Guide「Configuring Dynamic ARP Inspection」）にならう。
 *
 * - 信頼するポートで受け取った ARP は、確かめずに通す
 * - 信頼しないポートでは、ARP ACL を先に見る（許可の行に当たれば通し、拒否の行に当たれば束縛があっても捨てる）
 * - ACL に当たらなければ、DHCP スヌーピングの束縛表に、送信元の IP アドレスと MAC アドレスの組（SPA と SHA）があるかを見る
 * - 束縛は、信頼するポートから届いた DHCP サーバーの DHCPACK で記録する（RFC 7513 §6 も、SAVI について同じ規則を置く）
 *
 * 学習用の単純化: VLAN は 1 つ。追加の検査（src-mac、dst-mac、ip）とレート制限は扱わない
 */

export const BINDING_COLUMNS = ['IP', 'MAC', 'Port', 'Lease'] as const

export interface Binding {
  readonly ip: string
  readonly mac: string
  readonly port: number
  readonly leaseS: number
}

export interface AclEntry {
  readonly action: 'permit' | 'deny'
  readonly ip: string
  readonly mac: string
}

export interface DaiConfig {
  readonly trustedPorts: readonly number[]
  readonly bindings: readonly Binding[]
  readonly acl: readonly AclEntry[]
}

/** スイッチが受け取った ARP のうち、DAI が見るもの */
export interface InspectedArp {
  readonly port: number
  readonly sha: string
  readonly spa: string
}

export type DaiResult =
  | { readonly verdict: 'bypass' }
  | { readonly verdict: 'permit'; readonly by: 'acl' | 'binding' }
  | { readonly verdict: 'drop'; readonly by: 'acl' | 'noBinding' }

export function inspectArp(packet: InspectedArp, config: DaiConfig): DaiResult {
  if (config.trustedPorts.includes(packet.port)) {
    return { verdict: 'bypass' }
  }
  const aclEntry = config.acl.find((entry) => entry.ip === packet.spa && entry.mac === packet.sha)
  if (aclEntry !== undefined) {
    return aclEntry.action === 'permit'
      ? { verdict: 'permit', by: 'acl' }
      : { verdict: 'drop', by: 'acl' }
  }
  const bound = config.bindings.some(
    (binding) => binding.ip === packet.spa && binding.mac === packet.sha,
  )
  return bound ? { verdict: 'permit', by: 'binding' } : { verdict: 'drop', by: 'noBinding' }
}

/** スイッチの状態に出す 1 行（翻訳しない） */
export function describeDai(result: DaiResult, packet: InspectedArp): string {
  const pair = `${packet.spa} ↔ ${packet.sha}`
  const port = `(port ${String(packet.port)})`
  switch (result.verdict) {
    case 'bypass':
      return `bypass: trusted port ${String(packet.port)}`
    case 'permit':
      return result.by === 'acl'
        ? `permit: ARP ACL ${pair} ${port}`
        : `permit: bound ${pair} ${port}`
    case 'drop':
      return result.by === 'acl'
        ? `drop: denied by ARP ACL ${pair} ${port}`
        : `drop: no binding for ${pair} ${port}`
  }
}

/** DHCP スヌーピング: 信頼するポートから届いた DHCPACK で、束縛を記録する。信頼しないポートからの DHCPACK は捨てる（null） */
export function bindingFromAck(
  ack: { readonly yiaddr: string; readonly chaddr: string; readonly leaseS: number },
  ingressPort: number,
  clientPort: number,
  trustedPorts: readonly number[],
): Binding | null {
  if (!trustedPorts.includes(ingressPort)) {
    return null
  }
  return { ip: ack.yiaddr, mac: ack.chaddr, port: clientPort, leaseS: ack.leaseS }
}
