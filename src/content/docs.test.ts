// @vitest-environment node
// テーマを足したときに手で揃える文書（README、PLAN、CLAUDE.md、分類の説明）が、コードとずれていないかを確かめる（#324）
import claudeMd from '../../CLAUDE.md?raw'
import planMd from '../../docs/PLAN.md?raw'
import readme from '../../README.md?raw'
import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { LEARNING_PATHS } from './learningPaths'
import { THEMES } from './registry'
import { groupByCategory, THEME_CATEGORIES, THEME_META, type ThemeId } from './themeMeta'

interface Keywords {
  /** 分類の説明（en） */
  readonly en: RegExp
  /** 分類の説明（ja） */
  readonly ja: RegExp
  /** PLAN §2 の表の行 */
  readonly plan: string
}

/** テーマを足すと型のエラーになるので、分類の説明と PLAN の表に書いたかを思い出せる */
const KEYWORDS: Readonly<Record<ThemeId, Keywords>> = {
  'osi-model': { en: /split into layers/, ja: /層に分ける/, plan: 'OSI 参照モデル' },
  'subnet-calculator': {
    en: /divided into networks/,
    ja: /ネットワークに分ける/,
    plan: 'サブネット計算',
  },
  'ipv6-address': {
    en: /IPv6 addresses are written/,
    ja: /IPv6 アドレスの書き方/,
    plan: 'IPv6 アドレスの表記',
  },
  arp: { en: /\(ARP\)/, ja: /（ARP）/, plan: '| ARP |' },
  dhcp: { en: /\(DHCP\)/, ja: /（DHCP）/, plan: 'DHCP、ICMP' },
  icmp: { en: /\(ICMP\)/, ja: /（ICMP）/, plan: 'ICMP（ping/traceroute）' },
  pmtud: { en: /path MTU/, ja: /パス MTU/, plan: 'パス MTU 探索' },
  nat: { en: /\(NAT\)/, ja: /（NAT）/, plan: 'NAT／ルーティング' },
  'nat-traversal': { en: /STUN, TURN and ICE/, ja: /STUN・TURN・ICE/, plan: 'NAT 越え' },
  'route-lookup': { en: /next hop/, ja: /ネクストホップ/, plan: 'NAT／ルーティング' },
  'bgp-anycast': { en: /BGP/, ja: /BGP/, plan: 'BGP とエニーキャスト' },
  switching: { en: /switch does/, ja: /スイッチがフレーム/, plan: 'スイッチ、VLAN' },
  vlan: { en: /VLANs/, ja: /VLAN が/, plan: 'スイッチ、VLAN' },
  'container-networking': { en: /containers/, ja: /コンテナー/, plan: 'コンテナーのネットワーク' },
  vxlan: { en: /VXLAN/, ja: /VXLAN/, plan: 'VXLAN（オーバーレイ）' },
  wifi: { en: /Wi-Fi/, ja: /Wi-Fi/, plan: 'Wi-Fi（' },
  'ipv6-nd': {
    en: /IPv6 hosts find their neighbors/,
    ja: /IPv6 のホストが隣の機器/,
    plan: 'IPv6 の SLAAC・近隣探索',
  },
  'dns-resolution': { en: /\(DNS\)/, ja: /（DNS）/, plan: 'DNS 名前解決' },
  'tcp-handshake': { en: /\(TCP\)/, ja: /（TCP）/, plan: 'TCP 3ウェイハンドシェイク' },
  'tls-handshake': { en: /\(TLS\)/, ja: /（TLS）/, plan: 'TLS 1.3 と証明書チェーン検証' },
  'https-overview': { en: /\(HTTPS\)/, ja: /（HTTPS）/, plan: 'HTTPS の全体像' },
  'tcp-close': { en: /connection is closed/, ja: /接続の閉じ方/, plan: 'TCP の 4 ウェイクローズ' },
  'tcp-congestion': {
    en: /overloading the network/,
    ja: /ネットワークと受信側に送りすぎない/,
    plan: '輻輳制御',
  },
  'tcp-flow-control': {
    en: /and the receiver/,
    ja: /受信側に送りすぎない/,
    plan: 'TCP のフロー制御',
  },
  'tcp-sack': {
    en: /recovers lost segments/,
    ja: /失われたセグメントの取り戻し方/,
    plan: '高速再送と SACK',
  },
  'http-caching': { en: /caches responses/, ja: /キャッシュし/, plan: 'HTTP のキャッシュ' },
  cors: { en: /another origin/, ja: /別のオリジン/, plan: 'CORS' },
  http2: { en: /HTTP\/2/, ja: /HTTP\/2/, plan: 'HTTP/1.1 と HTTP/2' },
  quic: { en: /QUIC/, ja: /QUIC/, plan: '| QUIC |' },
  websocket: { en: /WebSocket/, ja: /WebSocket/, plan: '| WebSocket |' },
  'server-sent-events': {
    en: /Server-Sent Events/,
    ja: /Server-Sent Events/,
    plan: '| Server-Sent Events |',
  },
  'reverse-proxy': {
    en: /reverse proxy/,
    ja: /リバースプロキシ/,
    plan: 'リバースプロキシとロードバランサー',
  },
  oauth: { en: /OAuth 2\.0/, ja: /OAuth 2\.0/, plan: 'OAuth 2.0 と OpenID Connect' },
  'arp-spoofing': { en: /forged ARP reply/, ja: /偽の ARP の応答/, plan: 'ARP スプーフィング' },
  firewall: { en: /firewall/, ja: /ファイアウォール/, plan: 'ステートフルファイアウォール' },
  wireguard: { en: /WireGuard/, ja: /WireGuard/, plan: '| WireGuard（' },
  dnssec: { en: /DNSSEC/, ja: /DNSSEC/, plan: 'DNSSEC' },
  'mail-auth': { en: /DMARC/, ja: /DMARC/, plan: 'メールの送信ドメイン認証' },
  hsts: { en: /HSTS/, ja: /HSTS/, plan: 'HSTS と SSL ストリッピング' },
  csrf: { en: /CSRF tokens/, ja: /CSRF トークン/, plan: 'Cookie と CSRF' },
}

/** CLAUDE.md の「層を付けている」テーマの名前 */
const LAYER_LABELS: Readonly<Record<string, ThemeId>> = {
  'TCP のハンドシェイク': 'tcp-handshake',
  DNS: 'dns-resolution',
  ARP: 'arp',
  ICMP: 'icmp',
  'ARP スプーフィング': 'arp-spoofing',
  'HTTPS の全体像': 'https-overview',
}

/** `## 見出し` から次の `## ` までの本文 */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`)
  expect(start, heading).toBeGreaterThanOrEqual(0)
  const rest = markdown.slice(start + heading.length + 2)
  const end = rest.search(/\n## /)
  return end < 0 ? rest : rest.slice(0, end)
}

describe('README', () => {
  it('テーマの一覧は、分類の見出しとテーマの題名（en / ja）がコードと同じ順', () => {
    const lines = section(readme, '## Topics / テーマ')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('Available in'))
    const expected = groupByCategory(THEME_META).flatMap((group) => [
      `${en.categories[group.category].title} / ${ja.categories[group.category].title}`,
      ...group.themes.map((meta) => `- ${meta.title.en} / ${meta.title.ja}`),
    ])
    expect(lines).toEqual(expected)
  })

  it('道筋のテーマ数', () => {
    const text = section(readme, '## Learning paths / 学習の道筋')
    for (const path of LEARNING_PATHS) {
      const n = String(path.themeIds.length)
      expect(text).toContain(`${path.title.en} (${n} themes)`)
      expect(text).toContain(`${path.title.ja}（${n} テーマ）`)
    }
  })
})

describe('分類の説明（ホームとサイドバー）', () => {
  it.each(THEME_META.map((meta) => [meta.id, meta] as const))(
    '%s は、分類の説明（en / ja）で触れられている',
    (id, meta) => {
      expect(en.categories[meta.category].lead).toMatch(KEYWORDS[id].en)
      expect(ja.categories[meta.category].lead).toMatch(KEYWORDS[id].ja)
    },
  )

  it('どの分類にも説明がある', () => {
    for (const category of THEME_CATEGORIES) {
      expect(en.categories[category].lead).not.toBe('')
      expect(ja.categories[category].lead).not.toBe('')
    }
  })
})

describe('docs/PLAN.md', () => {
  it('テーマ数の連なり（N → M）はつながり、最後はテーマの数', () => {
    const counts = [...planMd.matchAll(/テーマは (\d+) → (\d+)/g)].map(([, from, to]) => [
      Number(from),
      Number(to),
    ])
    expect(counts.length).toBeGreaterThan(0)
    counts.slice(1).forEach(([from], i) => {
      expect(from, `連なりの ${String(i + 2)} 番目`).toBe(counts[i]?.[1])
    })
    expect(counts.at(-1)?.[1]).toBe(THEME_META.length)
  })

  it('道筋のテーマ数（Phase 16 の完了）の最後の数は、道筋の長さ', () => {
    for (const path of LEARNING_PATHS) {
      const match = new RegExp(`${path.title.ja}（([^）]*)）`).exec(planMd)
      const last = match?.[1]?.match(/\d+/g)?.at(-1)
      expect(Number(last), path.id).toBe(path.themeIds.length)
    }
  })

  it('§2 の表に、すべてのテーマがある', () => {
    const table = planMd.slice(planMd.indexOf('\n## 2.'), planMd.indexOf('\n## 3.'))
    for (const meta of THEME_META) {
      expect(table.includes(KEYWORDS[meta.id].plan), meta.id).toBe(true)
    }
  })
})

describe('CLAUDE.md', () => {
  it('「層を付けている」テーマの一覧は、フィールドに層を持つシナリオと同じ', () => {
    const listed = /今は (.+?)に付けている/.exec(claudeMd)?.[1]?.split('・') ?? []
    const documented = listed.map((label) => LAYER_LABELS[label] ?? `unknown: ${label}`).sort()
    const actual = THEMES.flatMap((theme) => {
      if (theme.kind !== 'sequence') return []
      const { steps } = theme.scenario.resolve({})
      const hasLayer = steps.some((step) =>
        step.events.some(
          (event) =>
            event.kind === 'message' && event.message.fields.some((f) => f.layer !== undefined),
        ),
      )
      return hasLayer ? [theme.meta.id] : []
    }).sort()
    expect(documented).toEqual(actual)
  })
})
