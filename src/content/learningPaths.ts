import type { LocalizedText } from '@/lib/i18n/locale'
import type { ThemeId } from './themeMeta'

// 対象者別の学習の道筋（#243）。テーマごとの対象者のタグは付けず、同じテーマを複数の道筋に入れる。
// scripts と e2e からも読むので、DOM や zod に依存しない（型だけを import する）

/** ホームに並べる順。id は URL（/:locale/paths/:id）に使うので、英小文字・数字・ハイフンのみ */
export const LEARNING_PATH_IDS = ['web-developer', 'infrastructure'] as const
export type LearningPathId = (typeof LEARNING_PATH_IDS)[number]

export interface LearningPathDef {
  /** 道筋の名前（h1、カード、ナビゲーション） */
  readonly title: LocalizedText
  /** 説明（リード文、meta の description） */
  readonly summary: LocalizedText
  /** 読む順のテーマ */
  readonly themeIds: readonly ThemeId[]
}

export interface LearningPath extends LearningPathDef {
  readonly id: LearningPathId
}

// Record にして、どの id にも定義がちょうど 1 つあることを型で強制する（順序は LEARNING_PATH_IDS で決める）
const LEARNING_PATH_DEFS: Readonly<Record<LearningPathId, LearningPathDef>> = {
  'web-developer': {
    title: { en: 'Web developers', ja: 'Web エンジニア向け' },
    summary: {
      en: 'From the name in the address bar to the page on screen: DNS, TCP, TLS and HTTPS, then the HTTP features you use every day (caching, CORS, cookies and CSRF, HSTS, HTTP/2, QUIC, WebSocket, Server-Sent Events) and the reverse proxy in front of your servers.',
      ja: 'アドレスバーの名前から画面のページまで。DNS、TCP、TLS、HTTPS の流れを押さえてから、日々使う HTTP のしくみ（キャッシュ、CORS、Cookie と CSRF、HSTS、HTTP/2、QUIC、WebSocket、Server-Sent Events）と、サーバーの前に立つリバースプロキシへ進む。',
    },
    themeIds: [
      'osi-model',
      'dns-resolution',
      'tcp-handshake',
      'tls-handshake',
      'https-overview',
      'http-caching',
      'cors',
      'csrf',
      'hsts',
      'http2',
      'quic',
      'websocket',
      'server-sent-events',
      'reverse-proxy',
    ],
  },
  infrastructure: {
    title: { en: 'Infrastructure and operations', ja: 'インフラ運用向け' },
    summary: {
      en: 'How hosts get on the network and how packets find their way: addresses and subnets, ARP and DHCP, ping and traceroute, routing and NAT, switches, VLANs and container networks, then DNS, TCP, path MTU problems, overlays (VXLAN), firewalls, a WireGuard VPN, HTTPS and HTTP caching, and the reverse proxy in front of your services.',
      ja: 'ホストがネットワークにつながり、パケットが行き先にたどり着くまで。アドレスとサブネット、ARP と DHCP、ping と traceroute、経路制御と NAT、スイッチと VLAN、コンテナーのネットワークを押さえてから、DNS、TCP、パス MTU の問題、オーバーレイ（VXLAN）、ファイアウォール、WireGuard の VPN、HTTPS と HTTP のキャッシュ、サービスの前に立つリバースプロキシへ進む。',
    },
    themeIds: [
      'osi-model',
      'subnet-calculator',
      'arp',
      'dhcp',
      'icmp',
      'route-lookup',
      'nat',
      'switching',
      'vlan',
      'container-networking',
      'dns-resolution',
      'tcp-handshake',
      'pmtud',
      'vxlan',
      'firewall',
      'wireguard',
      'https-overview',
      'http-caching',
      'reverse-proxy',
    ],
  },
}

export const LEARNING_PATHS: readonly LearningPath[] = LEARNING_PATH_IDS.map((id) => ({
  id,
  ...LEARNING_PATH_DEFS[id],
}))

export function findLearningPath(id: string | undefined): LearningPath | undefined {
  return LEARNING_PATHS.find((path) => path.id === id)
}
