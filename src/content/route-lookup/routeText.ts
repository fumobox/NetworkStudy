import type { LocalizedText } from '@/lib/i18n/locale'
import type { Interface, LookupReason, RouteTableId } from './routing'

/** 経路の検索（RouteLookup）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const ROUTE_TEXT = {
  title: { en: 'Route lookup', ja: '経路の検索' },
  destination: { en: 'Destination IP address', ja: '宛先の IP アドレス' },
  destinationHint: {
    en: 'The IP address in the packet’s destination field.',
    ja: 'パケットの宛先に入っている IP アドレス。',
  },
  destinationInvalid: {
    en: 'Not a valid IPv4 address. The results below are for the last valid address.',
    ja: 'IPv4 アドレスの形になっていない。下の結果は、最後に入力した正しいアドレスのもの。',
  },
  tableChoice: { en: 'Routing table', ja: '経路表' },
  tables: {
    pc: { en: 'Your PC (192.168.1.10)', ja: 'PC（192.168.1.10）' },
    router: {
      en: 'Home router (LAN 192.168.1.1, WAN 203.0.113.5)',
      ja: '家庭のルーター（LAN 192.168.1.1、WAN 203.0.113.5）',
    },
  } satisfies Record<RouteTableId, LocalizedText>,
  examples: { en: 'Try these destinations', ja: '試す宛先' },
  columns: {
    use: { en: 'Use', ja: '使う' },
    prefix: { en: 'Prefix', ja: 'プレフィックス' },
    nextHop: { en: 'Next hop', ja: 'ネクストホップ' },
    iface: { en: 'Interface', ja: 'インターフェース' },
    metric: { en: 'Metric', ja: 'メトリック' },
    match: { en: 'Matches?', ja: '一致' },
  },
  routeLabel: (prefix: string): LocalizedText => ({
    en: `Use the route ${prefix}`,
    ja: `経路 ${prefix} を使う`,
  }),
  directlyConnected: { en: 'directly connected', ja: '直接接続' },
  interfaces: {
    lan: { en: 'LAN', ja: 'LAN' },
    wan: { en: 'WAN', ja: 'WAN' },
  } satisfies Record<Interface, LocalizedText>,
  matched: { en: 'yes', ja: 'はい' },
  notMatched: { en: 'no', ja: 'いいえ' },
  selected: { en: ' (selected)', ja: '（選ばれた経路）' },
  result: { en: 'Result', ja: '結果' },
  reasons: {
    longest: {
      en: 'The longest matching prefix wins.',
      ja: '一致したうち、プレフィックスがいちばん長い経路が選ばれる。',
    },
    metric: {
      en: 'Several routes have the same longest prefix, so the one with the smallest metric wins.',
      ja: '同じ長さの経路がいくつかあるので、メトリックがいちばん小さい経路が選ばれる。',
    },
    order: {
      en: 'The routes have the same prefix length and the same metric, so this tool takes the first one in the table.',
      ja: 'プレフィックスの長さもメトリックも同じなので、このツールでは表で先の経路を選ぶ。',
    },
    default: {
      en: 'Only the default route (/0) matches: it is used when nothing more specific does.',
      ja: '一致するのはデフォルト経路（/0）だけ。もっと詳しい経路がないときに使われる。',
    },
    none: {
      en: 'No route matches, so the packet cannot be forwarded. The router drops it and sends back ICMP Destination Unreachable (network unreachable, 3/0).',
      ja: '一致する経路がないので、パケットは転送できない。ルーターは捨てて、ICMP の Destination Unreachable（network unreachable、3/0）を返す。',
    },
  } satisfies Record<LookupReason, LocalizedText>,
  /** PC の経路表で経路がないとき。ホストはパケットを送り出せず、ICMP も生まれない */
  noneOnHost: {
    en: 'No route matches, so the PC cannot even send the packet. Nothing leaves the PC; the application gets an error (network unreachable).',
    ja: '一致する経路がないので、PC はパケットを送り出すこともできない。PC からは何も出ていかず、アプリケーションにエラー（network unreachable）が返る。',
  },
  onLink: (address: string): LocalizedText => ({
    en: `The destination is on a directly connected network: the frame goes to ${address} itself (ARP for ${address}).`,
    ja: `宛先は直接接続のネットワークにある。フレームは ${address} そのものに送る（${address} を ARP で調べる）。`,
  }),
  viaGateway: (address: string): LocalizedText => ({
    en: `The packet goes to the next hop ${address} (ARP for ${address}); the IP destination does not change.`,
    ja: `パケットはネクストホップ ${address} に送る（${address} を ARP で調べる）。IP の宛先は変わらない。`,
  }),
  binary: { en: 'Compare the bits', ja: 'ビットで比べる' },
  binaryLead: (length: number): LocalizedText => ({
    en: `The first ${String(length)} bits of the destination must equal the route’s prefix.`,
    ja: `宛先の先頭の ${String(length)} ビットが、経路のプレフィックスと同じでなければならない。`,
  }),
  binaryRows: {
    destination: { en: 'Destination', ja: '宛先' },
    prefix: { en: 'Prefix', ja: 'プレフィックス' },
  },
} as const
