import type { LocalizedText } from '@/lib/i18n/locale'
import type { AddressKind, MulticastScope, WellKnownGroup } from './ipv6'

/** IPv6 アドレスのツール（Ipv6Address）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const IPV6_TEXT = {
  title: { en: 'IPv6 address', ja: 'IPv6 アドレス' },
  address: { en: 'IPv6 address', ja: 'IPv6 アドレス' },
  addressHint: {
    en: 'Eight groups of up to four hex digits, separated by colons. One run of zero groups may be written as ::.',
    ja: '4 桁までの 16 進数を 8 つ、コロンで区切る。0 のグループの続きを 1 か所だけ :: と書ける。',
  },
  addressInvalid: {
    en: 'Not a valid IPv6 address. The results below are for the last valid address.',
    ja: 'IPv6 アドレスの形になっていない。下の結果は、最後に入力した正しいアドレスのもの。',
  },
  prefix: { en: 'Prefix length', ja: 'プレフィックス長' },
  prefixHint: {
    en: 'How many bits from the left are the prefix (0 to 128). Most LANs use /64.',
    ja: '左から何ビットがプレフィックスか（0〜128）。ほとんどの LAN は /64 を使う。',
  },
  examples: { en: 'Try these addresses', ja: '試すアドレス' },
  results: { en: 'Results', ja: '結果' },
  rows: {
    full: { en: 'Full form', ja: '省略しない表記' },
    canonical: { en: 'Recommended form (RFC 5952)', ja: '推奨の表記（RFC 5952）' },
    kind: { en: 'Kind', ja: '種類' },
    scope: { en: 'Multicast scope', ja: 'マルチキャストの範囲（scope）' },
    group: { en: 'Well-known group', ja: 'よく使うグループ' },
    prefix: { en: 'Prefix', ja: 'プレフィックス' },
    interfaceId: { en: 'Interface ID', ja: 'インターフェース ID' },
    solicitedNode: {
      en: 'Solicited-node multicast address',
      ja: '要請ノードマルチキャストアドレス',
    },
    multicastMac: {
      en: 'Ethernet MAC address it is sent to',
      ja: '送り先の Ethernet の MAC アドレス',
    },
    eui64: {
      en: 'Interface ID made from a MAC address',
      ja: 'MAC アドレスから作ったインターフェース ID',
    },
  },
  canonicalNote: {
    en: 'Lower case, no leading zeros, :: for the longest run of two or more zero groups (the first one if there is a tie).',
    ja: '小文字で、先頭の 0 を省き、2 つ以上続く 0 のグループのうちいちばん長いところ（同じ長さなら最初）を :: にする。',
  },
  solicitedNodeNote: {
    en: 'ff02::1:ff and the last 24 bits of the address. Neighbor Discovery sends its questions to this address instead of broadcasting.',
    ja: 'ff02::1:ff と、アドレスの下位 24 ビット。近隣探索は、ブロードキャストの代わりにこのアドレスに尋ねる。',
  },
  eui64Yes: (mac: string): LocalizedText => ({
    en: `Yes: ff:fe in the middle, from MAC address ${mac}`,
    ja: `はい。中央に ff:fe があり、MAC アドレス ${mac} から作られている`,
  }),
  eui64No: {
    en: 'No (random or manually chosen)',
    ja: 'いいえ（ランダム、または手で決めたもの）',
  },
  kinds: {
    unspecified: { en: 'Unspecified address', ja: '未指定アドレス' },
    loopback: { en: 'Loopback address', ja: 'ループバックアドレス' },
    ipv4Mapped: { en: 'IPv4-mapped address', ja: 'IPv4 射影アドレス' },
    multicast: { en: 'Multicast address', ja: 'マルチキャストアドレス' },
    linkLocal: { en: 'Link-local unicast address', ja: 'リンクローカルユニキャストアドレス' },
    uniqueLocal: { en: 'Unique local address', ja: 'ユニークローカルアドレス' },
    documentation: { en: 'Documentation address', ja: '文書用のアドレス' },
    globalUnicast: { en: 'Global unicast address', ja: 'グローバルユニキャストアドレス' },
    reserved: { en: 'Reserved or not assigned', ja: '予約済み、または未割り当て' },
  } satisfies Record<AddressKind, LocalizedText>,
  kindNotes: {
    unspecified: {
      en: 'Means “no address yet”, for example as the source during duplicate address detection.',
      ja: '「まだアドレスがない」という意味。重複アドレス検出のときの送信元などに使う。',
    },
    loopback: {
      en: 'The device itself, like 127.0.0.1 in IPv4.',
      ja: '自分自身。IPv4 の 127.0.0.1 にあたる。',
    },
    ipv4Mapped: {
      en: 'An IPv4 address written as IPv6, used inside programs that handle both.',
      ja: 'IPv4 のアドレスを IPv6 の形で表したもの。両方を扱うプログラムの中で使う。',
    },
    multicast: {
      en: 'A group address: every device that joined the group receives the packet.',
      ja: 'グループのアドレス。グループに入った機器がみなパケットを受け取る。',
    },
    linkLocal: {
      en: 'Valid only on one link (one LAN). Every IPv6 interface has one; routers never forward it.',
      ja: '1 つのリンク（1 つの LAN）の中だけで使える。IPv6 のどのインターフェースにもあり、ルーターは転送しない。',
    },
    uniqueLocal: {
      en: 'For use inside an organization, like the private addresses of IPv4.',
      ja: '組織の中で使うアドレス。IPv4 のプライベートアドレスにあたる。',
    },
    documentation: {
      en: 'Reserved for examples in books and manuals (2001:db8::/32, 3fff::/20); never used on the Internet.',
      ja: '本やマニュアルの例のために予約されたアドレス（2001:db8::/32、3fff::/20）。インターネットでは使わない。',
    },
    globalUnicast: {
      en: 'A public address, reachable across the Internet.',
      ja: 'インターネットで通じる公開のアドレス。',
    },
    reserved: {
      en: 'Not assigned for normal use, or no longer used (such as the old site-local fec0::/10).',
      ja: 'ふつうの用途に割り当てられていないか、もう使われていないアドレス（古いサイトローカルの fec0::/10 など）。',
    },
  } satisfies Record<AddressKind, LocalizedText>,
  scopes: {
    interfaceLocal: { en: 'Interface-local (1)', ja: 'インターフェースの中（1）' },
    linkLocal: { en: 'Link-local (2)', ja: 'リンクの中（2）' },
    realmLocal: { en: 'Realm-local (3)', ja: 'レルムの中（3）' },
    adminLocal: { en: 'Admin-local (4)', ja: '管理者が決めた範囲（4）' },
    siteLocal: { en: 'Site-local (5)', ja: 'サイトの中（5）' },
    organizationLocal: { en: 'Organization-local (8)', ja: '組織の中（8）' },
    global: { en: 'Global (e)', ja: 'グローバル（e）' },
    reserved: { en: 'Reserved (0 or f)', ja: '予約（0 または f）' },
    unassigned: { en: 'Not assigned', ja: '未割り当て' },
  } satisfies Record<MulticastScope, LocalizedText>,
  groups: {
    allNodes: { en: 'All nodes on the link (ff02::1)', ja: 'リンクのすべてのノード（ff02::1）' },
    allRouters: {
      en: 'All routers on the link (ff02::2)',
      ja: 'リンクのすべてのルーター（ff02::2）',
    },
    solicitedNode: {
      en: 'Solicited-node multicast (ff02::1:ffxx:xxxx)',
      ja: '要請ノードマルチキャスト（ff02::1:ffxx:xxxx）',
    },
  } satisfies Record<WellKnownGroup, LocalizedText>,
  none: { en: '-', ja: '-' },
  /** 種類と、その範囲（ja は全角の括弧） */
  kindWithRange: (kind: LocalizedText, range: string): LocalizedText => ({
    en: `${kind.en} (${range})`,
    ja: `${kind.ja}（${range}）`,
  }),
  binary: {
    en: 'Prefix and interface ID in bits',
    ja: 'プレフィックスとインターフェース ID をビットで見る',
  },
  binaryLead: (prefix: number): LocalizedText => ({
    en: `The first ${String(prefix)} bits (bold and underlined) are the prefix; the rest is the interface ID.`,
    ja: `先頭の ${String(prefix)} ビット（太字と下線）がプレフィックスで、残りがインターフェース ID。`,
  }),
  mac: {
    title: { en: 'From a MAC address (EUI-64)', ja: 'MAC アドレスから（EUI-64）' },
    lead: {
      en: 'An interface ID can be made from a 48-bit MAC address: insert ff:fe in the middle and flip the U/L bit (the second lowest bit of the first byte).',
      ja: '48 ビットの MAC アドレスからインターフェース ID を作れる。中央に ff:fe を挟み、U/L ビット（最初のバイトの下から 2 ビット目）を反転する。',
    },
    input: { en: 'MAC address', ja: 'MAC アドレス' },
    invalid: {
      en: 'Not a valid MAC address (six bytes such as 00:00:5e:00:53:0a).',
      ja: 'MAC アドレスの形になっていない（00:00:5e:00:53:0a のような 6 バイト）。',
    },
    firstByte: { en: 'First byte', ja: '最初のバイト' },
    flipped: { en: 'After flipping the U/L bit', ja: 'U/L ビットを反転した後' },
    interfaceId: { en: 'EUI-64 interface ID', ja: 'EUI-64 のインターフェース ID' },
    linkLocal: { en: 'Link-local address', ja: 'リンクローカルアドレス' },
    note: {
      en: 'Many operating systems now use a random interface ID instead (RFC 7217, RFC 8981), so that the MAC address cannot be read from the IPv6 address.',
      ja: '今は多くの OS が、代わりにランダムなインターフェース ID を使う（RFC 7217、RFC 8981）。IPv6 アドレスから MAC アドレスを読み取れないようにするため。',
    },
    use: {
      en: 'Show this address above',
      ja: 'このアドレスを上に表示する',
    },
  },
} as const
