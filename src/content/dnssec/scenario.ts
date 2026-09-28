/**
 * DNSSEC: DNS の答えをたどる信頼の連鎖
 *
 * 根拠:
 * - RFC 4033 §3.1（データの出どころの認証と完全性）、§3.2（不在証明）、§4（提供しないもの: 機密性、DoS への対策）、§5（最後の区間）
 * - RFC 4034 §2（DNSKEY。§2.1.1: flags 256 はゾーンの鍵、257 はさらに SEP）、§3（RRSIG。§3.1.3 labels、§3.1.5 有効期間）、
 *   §5（DS。子の DNSKEY のダイジェスト。§5.1.4）、付録 B（key tag）
 * - RFC 4035 §2.2（すべての RRset に署名する）、§3.1.4（委任の応答に DS を含める）、§3.2.1（DO）、§3.2.2（CD: 応答にコピーし、
 *   検証に失敗したデータも返す）、§3.2.3（AD: 答えのすべての RRset が本物だと考えるときだけ）、§4.3（Secure / Insecure / Bogus /
 *   Indeterminate）、§4.4（トラストアンカー）、§5.2（委任の検証。DS がないことが証明されれば署名のない委任）、§5.3.1（RRSIG の検査。
 *   今の時刻が inception と expiration の間にあること）、§5.5（検証できなければ RCODE 2 = SERVFAIL。CD があれば全体を返す）
 * - RFC 6840 §5.7（問い合わせの AD: AD の値を理解しているという合図）、§5.8（AD は、問い合わせに DO か AD があったときだけ立てる）、
 *   §5.9（検証するリゾルバーは上流への問い合わせに CD を立てる）
 * - RFC 3225（DO ビット）、RFC 6891 §6.1.4（OPT の DO フラグ）
 * - RFC 5155 §6（Opt-Out）、§8.9（署名のない子ゾーンへの委任の検証）
 * - RFC 9904 §3、§4（アルゴリズム 13 = ECDSAP256SHA256 と、DS のダイジェスト 2 = SHA-256 は署名に推奨。RFC 8624 を置き換えた）
 * - RFC 7958（ルートのトラストアンカーの公開）、RFC 5011（トラストアンカーの自動更新）、RFC 5452（偽の応答）、RFC 8914（Extended DNS Errors）、
 *   RFC 7858 / RFC 8484（DoT / DoH）は概要で触れるだけ
 *
 * 学習用の単純化: 鍵、key tag、ダイジェストは架空の値（本物のルートの KSK は IANA が公開している）。アルゴリズムはどのゾーンも 13
 * （本物のルートは 8 = RSASHA256）。キャッシュは空で、毎回ルートから連鎖をたどる（実際は DNSKEY も DS もキャッシュする）。
 * QNAME minimisation は使わない。NSEC3 のハッシュは (hash of com.) などと書く。NXDOMAIN の不在証明（NSEC / NSEC3）は扱わない。書き換えられた答えは、途中の攻撃者が作ったものだが、
 * example.com のレーンから描く。PC とリゾルバーの間は信頼できるものとする。検証の日時は 2026-10-01（TLS のテーマと同じ）。
 * CD のとき、このページのリゾルバーは検証してから（結果にかかわらず）データを返す。検証に成功したときは AD も立てる
 * （CD のときは検証しないリゾルバーもある）
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  zone: z.enum(['signed', 'unsigned', 'tampered', 'expired']).catch('signed'),
  cd: z.stringbool().catch(false),
})
export type DnssecOptions = z.infer<typeof optionsSchema>
type Zone = DnssecOptions['zone']

const STUB: ActorId = 'stub'
const RESOLVER: ActorId = 'resolver'
const ROOT: ActorId = 'root'
const TLD: ActorId = 'tld'
const AUTH: ActorId = 'auth'

const RESULT: StateKey = 'result'
const CHAIN: StateKey = 'chain'
const CHECK: StateKey = 'check'
const ANSWER: StateKey = 'answer'

export const CHAIN_COLUMNS = ['Zone', 'DS (from parent)', 'DNSKEY', 'Status'] as const

export const ADDRESSES = {
  resolver: '198.51.100.53',
  root: '198.41.0.4',
  tld: '192.5.6.30',
  auth: '192.0.2.53',
} as const
export const WWW_ADDRESS = '192.0.2.10'
/** 書き換えられた答え */
export const FORGED_ADDRESS = '203.0.113.66'
const QNAME = 'www.example.com.'
const INCEPTION = '20260925000000'
const EXPIRATION = '20261015000000'
const EXPIRED_INCEPTION = '20260830000000'
const EXPIRED_EXPIRATION = '20260920000000'

const actors: readonly Actor[] = [
  {
    id: STUB,
    kind: 'client',
    name: { en: 'Your PC (stub resolver)', ja: 'PC（スタブリゾルバー）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: RESULT, label: { en: 'Result of the lookup', ja: '名前解決の結果' }, initial: '-' },
    ],
  },
  {
    id: RESOLVER,
    kind: 'resolver',
    name: { en: 'Validating resolver (198.51.100.53)', ja: '検証するリゾルバー（198.51.100.53）' },
    shortName: { en: 'Resolver', ja: 'リゾルバー' },
    stateSlots: [
      {
        key: CHAIN,
        label: { en: 'Chain of trust', ja: '信頼の連鎖' },
        initial: { columns: CHAIN_COLUMNS, rows: [] },
      },
      { key: CHECK, label: { en: 'Last signature check', ja: '最後の署名の検証' }, initial: '-' },
      { key: ANSWER, label: { en: 'www.example.com. A', ja: 'www.example.com. A' }, initial: '-' },
    ],
  },
  {
    id: ROOT,
    kind: 'nameServer',
    name: { en: 'Root server', ja: 'ルートサーバー' },
    shortName: { en: 'Root', ja: 'ルート' },
    stateSlots: [],
  },
  {
    id: TLD,
    kind: 'nameServer',
    name: { en: '.com TLD server', ja: '.com の TLD サーバー' },
    shortName: { en: '.com', ja: '.com' },
    stateSlots: [],
  },
  {
    id: AUTH,
    kind: 'nameServer',
    name: { en: 'example.com authoritative servers', ja: 'example.com の権威サーバー' },
    shortName: { en: 'example.com', ja: 'example.com' },
    stateSlots: [],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

type ChainRow = readonly [string, string, string, string]
const chain = (...rows: ChainRow[]): StateTable => ({ columns: CHAIN_COLUMNS, rows })

const ROOT_ROW = {
  anchor: ['.', 'trust anchor (KSK 1001)', '-', 'pending'],
  secure: ['.', 'trust anchor (KSK 1001)', 'KSK 1001, ZSK 1002', 'Secure'],
} satisfies Record<string, ChainRow>
const COM_ROW = {
  pending: ['com.', 'DS 2001 (from .)', '-', 'DS pending'],
  dsVerified: ['com.', 'DS 2001 (from .)', '-', 'DS verified'],
  secure: ['com.', 'DS 2001 (from .)', 'KSK 2001, ZSK 2002', 'Secure'],
} satisfies Record<string, ChainRow>
const EXAMPLE_ROW = {
  pending: ['example.com.', 'DS 3001 (from com.)', '-', 'DS pending'],
  dsVerified: ['example.com.', 'DS 3001 (from com.)', '-', 'DS verified'],
  secure: ['example.com.', 'DS 3001 (from com.)', 'KSK 3001, ZSK 3002', 'Secure'],
  bogus: ['example.com.', 'DS 3001 (from com.)', 'KSK 3001, ZSK 3002', 'Bogus'],
  noDs: ['example.com.', 'no DS (NSEC3, Opt-Out)', '-', 'pending'],
  insecure: ['example.com.', 'no DS (NSEC3, Opt-Out)', '-', 'Insecure'],
} satisfies Record<string, ChainRow>

const TEXT = {
  do: {
    en: 'DO (DNSSEC OK) in the EDNS0 OPT record: “include the DNSSEC records (RRSIG, DS, DNSKEY) in the answer”',
    ja: 'EDNS0 の OPT レコードの DO（DNSSEC OK）:「DNSSEC のレコード（RRSIG、DS、DNSKEY）も答えに入れてほしい」',
  },
  upstreamFlags: {
    en: 'No RD: an iterative query. CD (checking disabled): a validating resolver sets it on every upstream query, because it checks the signatures itself',
    ja: 'RD なし: 反復問い合わせ。CD（検証しない）: 検証するリゾルバーは、署名を自分で確かめるので、上流への問い合わせにはいつも立てる',
  },
  referral: {
    en: 'A referral: the servers for the next zone, and the DS record that links the two zones',
    ja: '委任: 次のゾーンのサーバーと、2 つのゾーンをつなぐ DS レコード',
  },
  rrsig: {
    en: 'RRSIG: type covered, algorithm (13 = ECDSAP256SHA256), labels, original TTL, expiration, inception, key tag of the signing key, and the signer’s zone. It signs the whole RRset',
    ja: 'RRSIG: 署名する型、アルゴリズム（13 = ECDSAP256SHA256）、ラベルの数、元の TTL、期限、開始、署名した鍵の key tag、署名したゾーン。RRset 全体に署名する',
  },
  dnskey: {
    en: 'DNSKEY flags 257 = zone key + SEP (the key-signing key, KSK); 256 = zone key (the zone-signing key, ZSK). Protocol 3, algorithm 13',
    ja: 'DNSKEY の flags 257 はゾーンの鍵 + SEP（鍵署名鍵、KSK）、256 はゾーンの鍵（ゾーン署名鍵、ZSK）。プロトコル 3、アルゴリズム 13',
  },
} satisfies Record<string, LocalizedText>

interface DnsSpec {
  readonly id: string
  readonly from: ActorId
  readonly to: ActorId
  readonly label: string
  readonly fields: readonly PacketField[]
  readonly status?: Message['status']
  readonly description?: LocalizedText
}

function dns(spec: DnsSpec): Message {
  const message: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields: spec.fields,
  }
  return spec.description === undefined ? message : { ...message, description: spec.description }
}

/** リゾルバーから上流のサーバーへの反復問い合わせ */
function upstream(id: string, to: ActorId, qtype: 'A' | 'DNSKEY', qname: string): Message {
  return dns({
    id,
    from: RESOLVER,
    to,
    label: qtype === 'A' ? `Query A ${QNAME.slice(0, -1)} (DO)` : `Query DNSKEY ${qname} (DO)`,
    fields: [
      {
        name: 'Transport',
        value: `UDP → ${ADDRESSES[to === ROOT ? 'root' : to === TLD ? 'tld' : 'auth']}:53`,
      },
      { name: 'Flags', value: 'CD', description: TEXT.upstreamFlags },
      { name: 'EDNS', value: 'OPT, DO=1', highlight: true, description: TEXT.do },
      { name: 'Question', value: `${qname} IN ${qtype}` },
    ],
  })
}

const rrsig = (
  type: string,
  labels: number,
  ttl: number,
  keyTag: number,
  signer: string,
  expired = false,
) =>
  `${type} 13 ${String(labels)} ${String(ttl)} ${expired ? EXPIRED_EXPIRATION : EXPIRATION} ${expired ? EXPIRED_INCEPTION : INCEPTION} ${String(keyTag)} ${signer}`

function dnskeyAnswer(options: {
  id: string
  from: ActorId
  zone: string
  ksk: number
  zsk: number
  ttl?: number
  expired?: boolean
  status?: Message['status']
}): Message {
  const { zone, ksk, zsk } = options
  const labels = zone === '.' ? 0 : zone.split('.').length - 1
  return dns({
    id: options.id,
    from: options.from,
    to: RESOLVER,
    label: `DNSKEY ${zone} (KSK ${String(ksk)}, ZSK ${String(zsk)})`,
    ...(options.status === undefined ? {} : { status: options.status }),
    fields: [
      { name: 'Flags', value: 'QR AA' },
      {
        name: 'Answer',
        value: [
          `${zone} DNSKEY 257 3 13 (KSK, key tag ${String(ksk)})`,
          `${zone} DNSKEY 256 3 13 (ZSK, key tag ${String(zsk)})`,
          `${zone} RRSIG ${rrsig('DNSKEY', labels, options.ttl ?? 3600, ksk, zone, options.expired)}`,
        ].join('\n'),
        highlight: true,
        description: TEXT.dnskey,
      },
    ],
  })
}

const QUESTION_SECTION: LocalizedText = { en: 'The question', ja: '問い合わせ' }
const ROOT_SECTION: LocalizedText = { en: '. (root)', ja: '.（ルート）' }
const COM_SECTION: LocalizedText = { en: 'com.', ja: 'com.' }
const EXAMPLE_SECTION: LocalizedText = { en: 'example.com.', ja: 'example.com.' }
const ANSWER_SECTION: LocalizedText = { en: 'Answer', ja: '答え' }

function stubQuery(cd: boolean): Message {
  const fields: PacketField[] = [
    { name: 'Transport', value: `UDP → ${ADDRESSES.resolver}:53` },
    {
      name: 'Flags',
      value: cd ? 'RD AD CD' : 'RD AD',
      highlight: true,
      description: cd
        ? {
            en: 'RD: resolve it for me. AD in a query: “I understand the AD bit; tell me whether you validated”. CD (checking disabled): “give me the data even if it fails validation; I will check it myself”',
            ja: 'RD: 解決してほしい。問い合わせの AD:「AD ビットを理解しているので、検証したかを教えてほしい」。CD（検証しない）:「検証に失敗してもデータをほしい。自分で確かめる」',
          }
        : {
            en: 'RD: resolve it for me. AD in a query: “I understand the AD bit; tell me whether you validated”',
            ja: 'RD: 解決してほしい。問い合わせの AD:「AD ビットを理解しているので、検証したかを教えてほしい」',
          },
    },
  ]
  if (cd) {
    fields.push({
      name: 'EDNS',
      value: 'OPT, DO=1',
      description: {
        en: 'The PC also sets DO, so that it receives the RRSIGs and can check them itself',
        ja: 'PC は DO も立てる。RRSIG を受け取って、自分で確かめられるようにするため',
      },
    })
  }
  fields.push({ name: 'Question', value: `${QNAME} IN A` })
  return dns({
    id: 'stub-query',
    from: STUB,
    to: RESOLVER,
    label: `Query A ${QNAME.slice(0, -1)}`,
    fields,
  })
}

function startSteps(cd: boolean): Step[] {
  return [
    {
      id: 'anchor',
      section: QUESTION_SECTION,
      title: {
        en: 'The resolver starts from the root trust anchor',
        ja: 'リゾルバーはルートのトラストアンカーから始める',
      },
      description: {
        en: 'A validating resolver trusts exactly one thing without proof: the root zone’s key-signing key (KSK), configured as a trust anchor. IANA publishes it, and resolvers can follow its changes automatically (RFC 5011). Every other key and record must be proven, step by step, from this anchor. The keys and numbers on this page are made up.',
        ja: '検証するリゾルバーが証明なしに信じるのは 1 つだけ。トラストアンカーとして設定した、ルートゾーンの鍵署名鍵（KSK）。IANA が公開していて、リゾルバーはその変更に自動でついていける（RFC 5011）。ほかの鍵とレコードは、すべてこのアンカーから一歩ずつ証明する。このページの鍵と番号は架空のもの。',
      },
      events: [set(RESOLVER, CHAIN, chain(ROOT_ROW.anchor))],
    },
    {
      id: 'stub-query',
      section: QUESTION_SECTION,
      title: cd
        ? { en: 'Your PC asks, with AD and CD', ja: 'PC が AD と CD を立てて問い合わせる' }
        : { en: 'Your PC asks, and says it wants AD', ja: 'PC が問い合わせ、AD を求める' },
      description: cd
        ? {
            en: 'The PC asks for www.example.com. It sets AD to say it understands the AD bit, and also CD (checking disabled): it wants the data even if validation fails, because it will validate itself.',
            ja: 'PC が www.example.com を問い合わせる。AD を立てて AD ビットを理解していることを示し、CD（検証しない）も立てる。自分で検証するので、検証に失敗してもデータがほしい。',
          }
        : {
            en: 'The PC asks for www.example.com as usual. By setting AD in the query, it says it understands the AD bit in the answer: “tell me whether you validated this”.',
            ja: 'PC はいつものように www.example.com を問い合わせる。問い合わせに AD を立てて、答えの AD ビットを理解していることを示す。「検証したかどうかを教えてほしい」。',
          },
      events: [send(stubQuery(cd))],
    },
  ]
}

function rootSteps(): Step[] {
  return [
    {
      id: 'root',
      section: ROOT_SECTION,
      title: {
        en: 'The root refers to .com and includes the DS for com.',
        ja: 'ルートが .com を紹介し、com. の DS を添える',
      },
      description: {
        en: 'As in ordinary DNS, the root answers with a referral to the .com servers. Because the resolver set DO, the referral also carries the DS record for com. and its RRSIG. The DS lives in the parent zone (here the root) and holds a hash of the child’s KSK: it is how the parent vouches for the child’s key.',
        ja: 'ふつうの DNS と同じく、ルートは .com のサーバーへの委任で答える。リゾルバーが DO を立てたので、委任には com. の DS レコードとその RRSIG も入っている。DS は親のゾーン（ここではルート）にあり、子の KSK のハッシュを持つ。親が子の鍵を保証するしくみ。',
      },
      events: [
        send(upstream('root-query', ROOT, 'A', QNAME)),
        send(
          dns({
            id: 'root-referral',
            from: ROOT,
            to: RESOLVER,
            label: 'Referral: com. NS + DS',
            fields: [
              { name: 'Flags', value: 'QR' },
              {
                name: 'Authority',
                value: [
                  'com. NS a.gtld-servers.net.',
                  'com. DS 2001 13 2 e2d3…',
                  `com. RRSIG ${rrsig('DS', 1, 86400, 1002, '.')}`,
                ].join('\n'),
                highlight: true,
                description: TEXT.referral,
              },
              { name: 'Additional', value: `a.gtld-servers.net. A ${ADDRESSES.tld}` },
            ],
            description: {
              en: 'DS 2001 13 2: key tag 2001, algorithm 13, digest type 2 (SHA-256), then the digest (shortened here).',
              ja: 'DS 2001 13 2: key tag 2001、アルゴリズム 13、ダイジェストの種類 2（SHA-256）、続いてダイジェスト（ここでは省略）。',
            },
          }),
        ),
        set(RESOLVER, CHAIN, chain(ROOT_ROW.anchor, COM_ROW.pending)),
      ],
    },
    {
      id: 'root-keys',
      section: ROOT_SECTION,
      title: {
        en: 'The root DNSKEY set is checked against the anchor',
        ja: 'ルートの DNSKEY をトラストアンカーと照らす',
      },
      description: {
        en: 'To check the RRSIG on the DS, the resolver needs the root’s keys. The root’s KSK matches the trust anchor, and the KSK’s signature over the whole DNSKEY set is valid, so the zone-signing key (ZSK) 1002 is genuine too. ZSK 1002 signed the DS for com., so that DS is now proven. By convention the KSK signs only the DNSKEY set and the ZSK signs everything else.',
        ja: 'DS の RRSIG を確かめるには、ルートの鍵が要る。ルートの KSK はトラストアンカーと一致し、DNSKEY 全体への KSK の署名も正しいので、ゾーン署名鍵（ZSK）の 1002 も本物だとわかる。com. の DS に署名したのは ZSK 1002 なので、その DS も証明された。慣習として、KSK は DNSKEY だけに署名し、ZSK がそれ以外に署名する。',
      },
      events: [
        send(upstream('root-keys-query', ROOT, 'DNSKEY', '.')),
        send(dnskeyAnswer({ id: 'root-keys', from: ROOT, zone: '.', ksk: 1001, zsk: 1002 })),
        set(RESOLVER, CHECK, 'KSK 1001 = anchor ✓; RRSIG(DNSKEY) ✓; RRSIG(com. DS) ✓'),
        set(RESOLVER, CHAIN, chain(ROOT_ROW.secure, COM_ROW.dsVerified)),
      ],
    },
  ]
}

function comSteps(zone: Zone): Step[] {
  const unsigned = zone === 'unsigned'
  return [
    {
      id: 'tld',
      section: COM_SECTION,
      title: unsigned
        ? {
            en: '.com refers to example.com and proves there is no DS',
            ja: '.com が example.com を紹介し、DS がないことを証明する',
          }
        : {
            en: '.com refers to example.com and includes its DS',
            ja: '.com が example.com を紹介し、その DS を添える',
          },
      description: unsigned
        ? {
            en: 'example.com is not signed, so .com has no DS for it. Instead, the referral carries signed NSEC3 records: one matching com. itself, and one whose hash range covers example.com and whose Opt-Out flag allows unsigned delegations in that range. Together they prove that the delegation is deliberately unsigned. That makes it an insecure delegation, not a broken one.',
            ja: 'example.com は署名されていないので、.com にはその DS がない。代わりに委任には、署名つきの NSEC3 レコードが入っている。1 つは com. そのものに一致し、もう 1 つはハッシュの範囲が example.com を覆い、Opt-Out のフラグでその範囲に署名のない委任を認める。2 つを合わせて、委任に署名がないのは意図したものだと証明する。これは壊れた委任ではなく、署名のない委任（insecure）。',
          }
        : {
            en: 'The .com server refers the resolver to the example.com servers. The referral carries the DS record for example.com, signed by com.’s ZSK 2002.',
            ja: '.com のサーバーは、example.com のサーバーへの委任で答える。委任には example.com の DS レコードが入っていて、com. の ZSK 2002 で署名されている。',
          },
      events: [
        send(upstream('tld-query', TLD, 'A', QNAME)),
        send(
          dns({
            id: 'tld-referral',
            from: TLD,
            to: RESOLVER,
            label: unsigned
              ? 'Referral: example.com. NS (no DS)'
              : 'Referral: example.com. NS + DS',
            fields: [
              { name: 'Flags', value: 'QR' },
              {
                name: 'Authority',
                value: (unsigned
                  ? [
                      'example.com. NS ns1.example.com.',
                      '(hash of com.).com. NSEC3 1 1 0 - (next) NS SOA RRSIG DNSKEY NSEC3PARAM',
                      `(hash of com.).com. RRSIG ${rrsig('NSEC3', 2, 86400, 2002, 'com.')}`,
                      '(before).com. NSEC3 1 1 0 - (after) NS DS RRSIG',
                      `(before).com. RRSIG ${rrsig('NSEC3', 2, 86400, 2002, 'com.')}`,
                    ]
                  : [
                      'example.com. NS ns1.example.com.',
                      'example.com. DS 3001 13 2 7a1f…',
                      `example.com. RRSIG ${rrsig('DS', 2, 86400, 2002, 'com.')}`,
                    ]
                ).join('\n'),
                highlight: true,
                description: unsigned
                  ? {
                      en: 'No DS. The first NSEC3 matches com. itself (the closest encloser). The second one’s hash range covers example.com, and its flags 1 = Opt-Out: unsigned delegations in that range may exist without their own NSEC3. Together they prove that there is no signed delegation for this name',
                      ja: 'DS はない。1 つ目の NSEC3 は com. そのもの（最も近い上位の名前）に一致する。2 つ目はハッシュの範囲が example.com を覆い、flags 1 = Opt-Out なので、その範囲には自分の NSEC3 を持たない署名のない委任がありうる。2 つを合わせて、この名前に署名つきの委任がないことを証明する',
                    }
                  : TEXT.referral,
              },
              { name: 'Additional', value: `ns1.example.com. A ${ADDRESSES.auth}` },
            ],
          }),
        ),
        set(
          RESOLVER,
          CHAIN,
          chain(
            ROOT_ROW.secure,
            COM_ROW.dsVerified,
            unsigned ? EXAMPLE_ROW.noDs : EXAMPLE_ROW.pending,
          ),
        ),
      ],
    },
    {
      id: 'tld-keys',
      section: COM_SECTION,
      title: {
        en: 'com.’s DNSKEY set: the DS links it to the root',
        ja: 'com. の DNSKEY: DS がルートにつなぐ',
      },
      description: {
        en: `The resolver fetches com.’s keys. The hash of KSK 2001 equals the DS that the root signed, so the KSK is genuine; the KSK signed the DNSKEY set, so ZSK 2002 is genuine; and ZSK 2002 signed ${unsigned ? 'the NSEC3 record. The absence of a DS for example.com is now proven: the zone is Insecure, and its answers can only be treated as ordinary, unvalidated DNS.' : 'the DS for example.com. One more link is proven.'}`,
        ja: `リゾルバーは com. の鍵を取る。KSK 2001 のハッシュは、ルートが署名した DS と一致するので、KSK は本物。その KSK が DNSKEY 全体に署名しているので ZSK 2002 も本物。ZSK 2002 は${unsigned ? ' NSEC3 レコードに署名している。これで example.com に DS がないことが証明された。ゾーンは Insecure（署名がない）で、その答えは検証されていないふつうの DNS として扱うしかない。' : ' example.com の DS に署名している。連鎖がもう 1 つつながった。'}`,
      },
      events: [
        send(upstream('tld-keys-query', TLD, 'DNSKEY', 'com.')),
        send(
          dnskeyAnswer({
            id: 'tld-keys',
            from: TLD,
            zone: 'com.',
            ksk: 2001,
            zsk: 2002,
            ttl: 86400,
          }),
        ),
        set(
          RESOLVER,
          CHECK,
          unsigned
            ? 'hash(KSK 2001) = DS ✓; RRSIG(DNSKEY) ✓; RRSIG(NSEC3) ✓'
            : 'hash(KSK 2001) = DS ✓; RRSIG(DNSKEY) ✓; RRSIG(DS) ✓',
        ),
        set(
          RESOLVER,
          CHAIN,
          chain(
            ROOT_ROW.secure,
            COM_ROW.secure,
            unsigned ? EXAMPLE_ROW.insecure : EXAMPLE_ROW.dsVerified,
          ),
        ),
      ],
    },
  ]
}

/** 検証に失敗する答えは rejected で描く（CD のときはリゾルバーが PC に渡すので delivered） */
function authAnswer(zone: Zone, cd: boolean): Message {
  const signed = `${QNAME} RRSIG ${rrsig('A', 3, 300, 3002, 'example.com.', zone === 'expired')}`
  const address = zone === 'tampered' ? FORGED_ADDRESS : WWW_ADDRESS
  const answer =
    zone === 'unsigned' ? `${QNAME} A ${WWW_ADDRESS}` : [`${QNAME} A ${address}`, signed].join('\n')
  const label =
    zone === 'unsigned'
      ? `Answer: A ${WWW_ADDRESS}`
      : zone === 'expired'
        ? `Answer: A ${WWW_ADDRESS} + RRSIG (expired)`
        : `Answer: A ${address} + RRSIG`
  return dns({
    id: 'auth-answer',
    from: AUTH,
    to: RESOLVER,
    label,
    status: (zone === 'tampered' || zone === 'expired') && !cd ? 'rejected' : 'delivered',
    fields: [
      { name: 'Flags', value: 'QR AA' },
      zone === 'unsigned'
        ? { name: 'Answer', value: answer, highlight: true }
        : { name: 'Answer', value: answer, highlight: true, description: TEXT.rrsig },
    ],
    ...(zone === 'tampered'
      ? {
          description: {
            en: 'Drawn from the example.com lane, but forged on the way: the address was changed, while the RRSIG is the genuine one over 192.0.2.10.',
            ja: 'example.com のレーンから描いているが、途中で偽造されたもの。アドレスは書き換えられ、RRSIG は 192.0.2.10 に対する本物のまま。',
          },
        }
      : {}),
  })
}

function exampleSteps(zone: Zone, cd: boolean): Step[] {
  const steps: Step[] = [
    {
      id: 'auth',
      section: EXAMPLE_SECTION,
      title:
        zone === 'unsigned'
          ? { en: 'example.com answers, without a signature', ja: 'example.com が署名なしで答える' }
          : zone === 'tampered'
            ? {
                en: 'An altered answer arrives',
                ja: '書き換えられた答えが届く',
              }
            : zone === 'expired'
              ? {
                  en: 'The answer arrives with an expired signature',
                  ja: '期限切れの署名つきの答えが届く',
                }
              : {
                  en: 'example.com answers with the A record and its RRSIG',
                  ja: 'example.com が A レコードと RRSIG を返す',
                },
      description:
        zone === 'unsigned'
          ? {
              en: 'The authoritative server answers with the address and no RRSIG. Since the resolver already proved that example.com is unsigned, it does not expect one.',
              ja: '権威サーバーはアドレスだけを返し、RRSIG はない。リゾルバーはすでに example.com に署名がないことを証明したので、RRSIG を期待しない。',
            }
          : zone === 'tampered'
            ? {
                en: 'An attacker’s forged response wins the race against the real one: the address says 203.0.113.66. The attacker cannot produce a valid signature without example.com’s private key, so the RRSIG is still the one made over 192.0.2.10. The resolver cannot tell yet: it needs example.com’s keys first.',
                ja: '攻撃者の偽の応答が本物より先に届く。アドレスは 203.0.113.66。攻撃者は example.com の秘密鍵を持たないので正しい署名は作れず、RRSIG は 192.0.2.10 に対して作られたもののまま。リゾルバーにはまだわからない。先に example.com の鍵が要る。',
              }
            : zone === 'expired'
              ? {
                  en: 'The zone’s signatures were not renewed in time: every RRSIG expired on 2026-09-20, and today is 2026-10-01. Signatures are only valid between their inception and expiration times, so zones must be re-signed regularly.',
                  ja: 'ゾーンの署名が期限までに更新されなかった。どの RRSIG も 2026-09-20 に期限が切れていて、今日は 2026-10-01。署名は開始と期限の間だけ有効なので、ゾーンは定期的に再署名しなければならない。',
                }
              : {
                  en: 'The authoritative server returns the A record together with its RRSIG, made with example.com’s ZSK 3002. An RRSIG signs a whole RRset (all the A records of the name together), not a single record.',
                  ja: '権威サーバーは A レコードと、example.com の ZSK 3002 で作った RRSIG を返す。RRSIG は 1 つのレコードではなく、RRset 全体（その名前の A レコードすべて）に署名する。',
                },
      events: [
        send(upstream('auth-query', AUTH, 'A', QNAME)),
        send(authAnswer(zone, cd)),
        ...(zone === 'unsigned' ? [set(RESOLVER, ANSWER, 'Insecure')] : []),
      ],
    },
  ]
  if (zone === 'unsigned') return steps

  const bogus = zone === 'tampered' || zone === 'expired'
  steps.push({
    id: 'auth-keys',
    section: EXAMPLE_SECTION,
    title: bogus
      ? { en: 'The check fails: Bogus', ja: '検証に失敗する: Bogus' }
      : {
          en: 'example.com’s DNSKEY set completes the chain',
          ja: 'example.com の DNSKEY で連鎖が完成する',
        },
    description:
      zone === 'tampered'
        ? {
            en: 'The keys check out: KSK 3001 matches the DS from com., and it signed the DNSKEY set. But ZSK 3002’s signature does not match the data received, because the address was changed after signing. The answer is Bogus.',
            ja: '鍵は正しい。KSK 3001 は com. の DS と一致し、DNSKEY 全体に署名している。しかし受け取ったデータに ZSK 3002 の署名が合わない。署名の後でアドレスが書き換えられたから。答えは Bogus（偽物）。',
          }
        : zone === 'expired'
          ? {
              en: 'KSK 3001 still matches the DS from com., but the signatures over the DNSKEY set and over the A record both expired on 2026-09-20. A signature outside its validity period does not count, so nothing below the DS can be proven: the answer is Bogus.',
              ja: 'KSK 3001 は com. の DS と一致するが、DNSKEY 全体への署名も A レコードへの署名も、2026-09-20 に期限が切れている。有効期間の外の署名は数えないので、DS より下は何も証明できない。答えは Bogus（偽物）。',
            }
          : {
              en: 'KSK 3001 matches the DS from com.; it signed the DNSKEY set, so ZSK 3002 is genuine; and ZSK 3002’s signature matches the A record. Every link from the root trust anchor down to the answer is proven: the answer is Secure.',
              ja: 'KSK 3001 は com. の DS と一致し、DNSKEY 全体に署名しているので ZSK 3002 も本物。ZSK 3002 の署名は A レコードと合う。ルートのトラストアンカーから答えまで、すべてのつながりが証明された。答えは Secure（検証できた）。',
            },
    events: [
      send(upstream('auth-keys-query', AUTH, 'DNSKEY', 'example.com.')),
      send(
        dnskeyAnswer({
          id: 'auth-keys',
          from: AUTH,
          zone: 'example.com.',
          ksk: 3001,
          zsk: 3002,
          expired: zone === 'expired',
          ...(zone === 'expired' && !cd ? { status: 'rejected' as const } : {}),
        }),
      ),
      set(
        RESOLVER,
        CHECK,
        zone === 'tampered'
          ? 'hash(KSK 3001) = DS ✓; RRSIG(DNSKEY) ✓; RRSIG(A) ✗'
          : zone === 'expired'
            ? 'hash(KSK 3001) = DS ✓; RRSIG(DNSKEY) expired ✗; RRSIG(A) expired ✗'
            : 'hash(KSK 3001) = DS ✓; RRSIG(DNSKEY) ✓; RRSIG(A) ✓',
      ),
      set(
        RESOLVER,
        CHAIN,
        chain(ROOT_ROW.secure, COM_ROW.secure, bogus ? EXAMPLE_ROW.bogus : EXAMPLE_ROW.secure),
      ),
      set(
        RESOLVER,
        ANSWER,
        zone === 'tampered'
          ? 'Bogus (signature invalid)'
          : zone === 'expired'
            ? 'Bogus (RRSIG expired)'
            : 'Secure',
      ),
    ],
  })
  return steps
}

function stubAnswer(options: DnssecOptions): Step {
  const { zone, cd } = options
  const bogus = zone === 'tampered' || zone === 'expired'
  const address = zone === 'tampered' ? FORGED_ADDRESS : WWW_ADDRESS

  if (bogus && !cd) {
    return {
      id: 'stub-answer',
      section: ANSWER_SECTION,
      title: {
        en: 'Bogus: the resolver answers SERVFAIL',
        ja: 'Bogus: リゾルバーは SERVFAIL を返す',
      },
      description: {
        en: 'The resolver must not hand out data that failed validation, so it answers SERVFAIL (RCODE 2) instead of the address. The PC cannot tell from SERVFAIL alone whether the data was forged or a server was down; Extended DNS Errors (RFC 8914) can add the reason.',
        ja: 'リゾルバーは検証に失敗したデータを渡してはいけないので、アドレスの代わりに SERVFAIL（RCODE 2）を返す。PC は SERVFAIL だけでは、データが偽造されたのか、サーバーが止まっていたのかを区別できない。Extended DNS Errors（RFC 8914）で理由を添えられる。',
      },
      events: [
        send(
          dns({
            id: 'stub-answer',
            from: RESOLVER,
            to: STUB,
            label: 'SERVFAIL',
            fields: [
              { name: 'Flags', value: 'QR RD RA' },
              {
                name: 'RCODE',
                value: 'SERVFAIL',
                highlight: true,
                description: {
                  en: 'Server failure: the resolver could not produce a trustworthy answer',
                  ja: 'サーバーの失敗: リゾルバーは信頼できる答えを作れなかった',
                },
              },
              { name: 'Answer', value: '(empty)' },
            ],
          }),
        ),
        set(STUB, RESULT, 'SERVFAIL'),
      ],
    }
  }

  const ad = !bogus && zone !== 'unsigned'
  const flags = ['QR', 'RD', 'RA', ...(ad ? ['AD'] : []), ...(cd ? ['CD'] : [])].join(' ')
  const answerValue =
    cd && zone !== 'unsigned'
      ? [`${QNAME} A ${address}`, `${QNAME} RRSIG A 13 3 300 …`].join('\n')
      : `${QNAME} A ${address}`
  const flagsDescription: LocalizedText = ad
    ? {
        en: `AD (authentic data): every RRset in the answer was validated. It is set because the query had AD${cd ? '. CD is copied from the query; this resolver validated anyway, so it still sets AD (some resolvers skip validation when CD is set)' : ''}`,
        ja: `AD（認証されたデータ）: 答えのすべての RRset を検証できた。問い合わせに AD があったので立てる${cd ? '。CD は問い合わせからコピーする。このリゾルバーは検証したので AD も立てる（CD のときは検証しないリゾルバーもある）' : ''}`,
      }
    : bogus
      ? {
          en: 'CD is copied from the query. No AD: the data failed validation, but the PC asked for it anyway',
          ja: 'CD は問い合わせからコピーする。AD はない。データは検証に失敗したが、PC がそれでもほしいと頼んだ',
        }
      : {
          en: `No AD: the zone is not signed, so there is nothing to validate${cd ? '. CD is copied from the query' : ''}`,
          ja: `AD はない。ゾーンに署名がないので、検証するものがない${cd ? '。CD は問い合わせからコピーする' : ''}`,
        }
  const result = ad ? `${address} (AD)` : bogus ? `${address} (CD, no AD)` : `${address} (no AD)`

  const title: LocalizedText = ad
    ? { en: 'The answer comes back with AD', ja: 'AD 付きで答えが返る' }
    : bogus
      ? {
          en: 'CD: the failed data is returned, without AD',
          ja: 'CD: 検証に失敗したデータを、AD なしで返す',
        }
      : {
          en: 'Insecure: the answer comes back without AD',
          ja: 'Insecure: AD なしで答えが返る',
        }
  const description: LocalizedText = ad
    ? {
        en: 'The resolver returns the address with the AD bit. DNSSEC secured the data, not the path: the last hop between the PC and the resolver is simply trusted here (or protected with DNS over TLS or HTTPS), and DNSSEC encrypts nothing, so anyone on the path can still read the question and the answer.',
        ja: 'リゾルバーは AD ビットを立ててアドレスを返す。DNSSEC が守ったのはデータで、経路ではない。PC とリゾルバーの間の最後の区間は、ここでは信頼するものとしている（または DNS over TLS や HTTPS で守る）。DNSSEC は何も暗号化しないので、経路の途中の誰でも問い合わせと答えを読める。',
      }
    : bogus
      ? {
          en: `Because the PC set CD, the resolver returns the data even though it failed validation, without AD, together with the RRSIGs (the PC set DO). The PC took responsibility for validating it itself, and would find ${zone === 'tampered' ? 'the forged address' : 'the expired signatures'} too.`,
          ja: `PC が CD を立てたので、リゾルバーは検証に失敗したデータでも、AD なしで、RRSIG とともに返す（PC は DO も立てた）。PC は自分で検証する責任を引き受けたので、${zone === 'tampered' ? '偽のアドレス' : '期限切れの署名'}に自分で気づくはず。`,
        }
      : {
          en: 'The resolver returns the address without AD. A zone that is provably unsigned is Insecure: its answers are ordinary DNS, with no error and no protection. Most names on the Internet are still in unsigned zones.',
          ja: 'リゾルバーは AD なしでアドレスを返す。署名がないことが証明されたゾーンは Insecure（署名がない）で、その答えはエラーでも保護されたものでもない、ふつうの DNS。インターネットの多くの名前は、今も署名のないゾーンにある。',
        }
  return {
    id: 'stub-answer',
    section: ANSWER_SECTION,
    title,
    description,
    events: [
      send(
        dns({
          id: 'stub-answer',
          from: RESOLVER,
          to: STUB,
          label: `Answer: A ${address}${ad ? ' (AD)' : cd ? ' (CD)' : ''}`,
          fields: [
            { name: 'Flags', value: flags, highlight: true, description: flagsDescription },
            { name: 'RCODE', value: 'NOERROR' },
            { name: 'Answer', value: answerValue },
          ],
        }),
      ),
      set(STUB, RESULT, result),
    ],
  }
}

function buildSteps(options: DnssecOptions): readonly Step[] {
  return [
    ...startSteps(options.cd),
    ...rootSteps(),
    ...comSteps(options.zone),
    ...exampleSteps(options.zone, options.cd),
    stubAnswer(options),
  ]
}

export const dnssecScenario: Scenario<DnssecOptions> = {
  id: 'dnssec',
  title: {
    en: 'DNSSEC: a chain of trust for DNS answers',
    ja: 'DNSSEC: DNS の答えをたどる信頼の連鎖',
  },
  actors,
  optionDefs: {
    zone: {
      kind: 'select',
      label: { en: 'The example.com zone', ja: 'example.com のゾーン' },
      choices: [
        { value: 'signed', label: { en: 'Signed correctly', ja: '正しく署名されている' } },
        {
          value: 'unsigned',
          label: { en: 'Not signed (no DS in .com)', ja: '署名なし（.com に DS がない）' },
        },
        {
          value: 'tampered',
          label: { en: 'The answer was altered on the way', ja: '答えが途中で書き換えられた' },
        },
        {
          value: 'expired',
          label: {
            en: 'Signatures expired (zone not re-signed)',
            ja: '署名の期限切れ（再署名されていない）',
          },
        },
      ],
      defaultValue: 'signed',
    },
    cd: {
      kind: 'toggle',
      label: {
        en: 'The PC sets CD (checking disabled)',
        ja: 'PC が CD（検証しない）を立てる',
      },
      description: {
        en: 'Changes the outcome only when validation fails.',
        ja: '検証に失敗するときだけ結果が変わる。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
