/**
 * DNS の名前解決（フルサービスリゾルバによる再帰的な解決）
 *
 * 根拠:
 * - RFC 1034 §4.3.1（再帰と反復の問い合わせ）, §4.3.2（権威サーバーの動作。委任・CNAME）, §5.3.3（リゾルバの動作）
 * - RFC 1035 §4.1（メッセージの形式: ID、QR / AA / RD / RA、RCODE、各セクション）
 * - RFC 1034 §4.2.1（glue）, RFC 2308 §2.1, §3, §5（否定応答の形と、その TTL = min(SOA の TTL, SOA の MINIMUM)）
 * - RFC 5452（ID と送信元ポートは推測されにくい値にする。このページの ID は読みやすさのための値）
 * - RFC 9156（QNAME minimisation。多くのリゾルバはルートや TLD に名前の一部しか送らない）
 * IP アドレスは RFC 5737 の文書用アドレス（192.0.2.0/24）を使う（ルートと .com のサーバーは実在のアドレス）
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
  cache: z.enum(['empty', 'delegation', 'answer']).catch('empty'),
  name: z.enum(['www', 'missing', 'alias']).catch('www'),
  serverDown: z.stringbool().catch(false),
})
export type DnsOptions = z.infer<typeof optionsSchema>

const STUB: ActorId = 'stub'
const RESOLVER: ActorId = 'resolver'
const ROOT: ActorId = 'root'
const TLD: ActorId = 'tld'
const AUTH: ActorId = 'auth'
const CACHE: StateKey = 'cache'
const RESULT: StateKey = 'result'

const CACHE_COLUMNS = ['NAME', 'TYPE', 'RDATA', 'TTL'] as const
const EMPTY_CACHE: StateTable = { columns: CACHE_COLUMNS, rows: [] }

const WWW = 'www.example.com.'
const MISSING = 'no-such-host.example.com.'
const ALIAS = 'shop.example.com.'
const WWW_ADDRESS = '192.0.2.10'
/** PC に設定されているリゾルバのアドレス（RFC 5737 の TEST-NET-2） */
const RESOLVER_ADDRESS = '198.51.100.53'
const ROOT_ADDRESS = '198.41.0.4'
const TLD_SERVER = 'a.gtld-servers.net.'
const TLD_ADDRESS = '192.5.6.30'
const NS1 = 'ns1.example.com.'
const NS1_ADDRESS = '192.0.2.53'
const NS2 = 'ns2.example.com.'
const NS2_ADDRESS = '192.0.2.54'
const DELEGATION_TTL = '172800'
const ANSWER_TTL = '300'
/** 否定応答の TTL = min(SOA の TTL, SOA の MINIMUM)（RFC 2308 §5） */
const NEGATIVE_TTL = '3600'
/** 1 台目の権威サーバーの応答を待つ時間（学習用の例。実際の値は実装や計測した RTT によって変わる） */
const QUERY_TIMEOUT_MS = 1500

const actors: readonly Actor[] = [
  {
    id: STUB,
    kind: 'client',
    name: { en: 'Your PC (stub resolver)', ja: 'PC（スタブリゾルバ）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: RESULT, label: { en: 'Result of the lookup', ja: '名前解決の結果' }, initial: '-' },
    ],
  },
  {
    id: RESOLVER,
    kind: 'resolver',
    name: { en: 'Full-service resolver', ja: 'フルサービスリゾルバ' },
    shortName: { en: 'Resolver', ja: 'リゾルバ' },
    stateSlots: [{ key: CACHE, label: { en: 'Cache', ja: 'キャッシュ' }, initial: EMPTY_CACHE }],
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

type Row = readonly [string, string, string, string]

const ROWS = {
  comNs: ['com.', 'NS', TLD_SERVER, DELEGATION_TTL],
  tldGlue: [TLD_SERVER, 'A', TLD_ADDRESS, DELEGATION_TTL],
  exampleNs1: ['example.com.', 'NS', NS1, DELEGATION_TTL],
  exampleNs2: ['example.com.', 'NS', NS2, DELEGATION_TTL],
  ns1Glue: [NS1, 'A', NS1_ADDRESS, DELEGATION_TTL],
  ns2Glue: [NS2, 'A', NS2_ADDRESS, DELEGATION_TTL],
  www: [WWW, 'A', WWW_ADDRESS, ANSWER_TTL],
  alias: [ALIAS, 'CNAME', WWW, ANSWER_TTL],
  // 否定キャッシュ: 「この名前はどのタイプでも存在しない」。NXDOMAIN はレコードのタイプではなく応答コード
  missing: [MISSING, '(negative)', 'NXDOMAIN (SOA example.com.)', NEGATIVE_TTL],
  /** 55 秒前にキャッシュされた www の答え（TTL 300 のうち残り 245 秒） */
  wwwCached: [WWW, 'A', WWW_ADDRESS, '245'],
} satisfies Record<string, Row>

const DELEGATION_ROWS: readonly Row[] = [
  ROWS.comNs,
  ROWS.tldGlue,
  ROWS.exampleNs1,
  ROWS.exampleNs2,
  ROWS.ns1Glue,
  ROWS.ns2Glue,
]

const SOA_ROW: Row = [
  'example.com.',
  'SOA',
  `${NS1} hostmaster.example.com. (MINIMUM ${NEGATIVE_TTL})`,
  NEGATIVE_TTL,
]

const AUTHORITATIVE_FLAGS: LocalizedText = {
  en: 'QR: a response. AA: the answer comes from the server responsible for example.com.',
  ja: 'QR: 応答。AA: example.com を担当するサーバーからの答えである。',
}

const TEXT = {
  transport: { en: 'DNS usually uses UDP port 53', ja: 'DNS はふつう UDP の 53 番ポートを使う' },
  id: {
    en: 'Chosen by the sender. The response carries the same ID so the sender can match it. Real resolvers pick hard-to-guess random IDs; this page uses readable values.',
    ja: '送信側が選ぶ番号。応答にも同じ ID が入り、送信側はそれで問い合わせと対応づける。実際のリゾルバは推測されにくい乱数にするが、ここでは読みやすい値にしている。',
  },
  question: { en: 'The name and type being asked for', ja: '問い合わせる名前とタイプ' },
} satisfies Record<string, LocalizedText>

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const cacheOf = (rows: readonly Row[]): StateTable => ({ columns: CACHE_COLUMNS, rows })

function query(options: {
  id: string
  from: ActorId
  to: ActorId
  dnsId: string
  qname: string
  recursive: boolean
  lost?: boolean
  destination: string
}): Message {
  const fields: PacketField[] = [
    { name: 'Transport', value: `UDP → ${options.destination}:53`, description: TEXT.transport },
    { name: 'ID', value: options.dnsId, description: TEXT.id },
    {
      name: 'Flags',
      value: options.recursive ? 'RD' : '(none)',
      highlight: true,
      description: options.recursive
        ? {
            en: 'RD (recursion desired): “please resolve it all the way for me”',
            ja: 'RD（再帰要求）: 「最後まで解決してほしい」という依頼',
          }
        : {
            en: 'No RD: the resolver asks iteratively and follows referrals itself',
            ja: 'RD なし: リゾルバは反復問い合わせをし、委任を自分でたどる',
          },
    },
    {
      name: 'Question',
      value: `${options.qname} IN A`,
      highlight: true,
      description: TEXT.question,
    },
  ]
  return {
    id: options.id,
    from: options.from,
    to: options.to,
    label: `Query A ${options.qname}`,
    status: options.lost === true ? 'lost' : 'delivered',
    description: options.recursive
      ? { en: 'A recursive query to the resolver.', ja: 'リゾルバへの再帰問い合わせ。' }
      : { en: 'An iterative query to a name server.', ja: 'ネームサーバーへの反復問い合わせ。' },
    fields,
  }
}

function response(options: {
  id: string
  from: ActorId
  to: ActorId
  dnsId: string
  label: string
  qname: string
  flags: string
  rcode: 'NOERROR' | 'NXDOMAIN'
  answer?: readonly Row[]
  authority?: readonly Row[]
  additional?: readonly Row[]
  description: LocalizedText
  flagsDescription: LocalizedText
}): Message {
  const records = (rows: readonly Row[] | undefined) =>
    rows === undefined || rows.length === 0
      ? '(empty)'
      : rows.map((row) => row.join(' ')).join('\n')
  return {
    id: options.id,
    from: options.from,
    to: options.to,
    label: options.label,
    status: 'delivered',
    description: options.description,
    fields: [
      { name: 'ID', value: options.dnsId, description: TEXT.id },
      {
        name: 'Flags',
        value: options.flags,
        highlight: true,
        description: options.flagsDescription,
      },
      {
        name: 'RCODE',
        value: options.rcode,
        highlight: options.rcode === 'NXDOMAIN',
        description:
          options.rcode === 'NXDOMAIN'
            ? {
                en: 'Name error: the name does not exist',
                ja: '名前のエラー: その名前は存在しない',
              }
            : { en: 'No error', ja: 'エラーなし' },
      },
      { name: 'Question', value: `${options.qname} IN A`, description: TEXT.question },
      {
        name: 'Answer',
        value: records(options.answer),
        highlight: options.answer !== undefined && options.answer.length > 0,
        description: { en: 'Records that answer the question', ja: '質問への答えになるレコード' },
      },
      {
        name: 'Authority',
        value: records(options.authority),
        highlight: options.answer === undefined || options.answer.length === 0,
        description: {
          en: 'Name servers to ask next (a referral), or the SOA for a negative answer',
          ja: '次に聞くべきネームサーバー（委任）、または否定応答のための SOA',
        },
      },
      {
        name: 'Additional',
        value: records(options.additional),
        description: {
          en: 'Extra records such as the addresses of those name servers (glue)',
          ja: 'それらのネームサーバーのアドレス（glue）などの補足のレコード',
        },
      },
    ],
  }
}

const NAMES = { www: WWW, missing: MISSING, alias: ALIAS } as const

function buildSteps(options: DnsOptions): readonly Step[] {
  const qname = NAMES[options.name]
  const steps: Step[] = []
  let cacheRows: Row[] = []
  /** キャッシュに足す。同じレコード（NAME・TYPE・RDATA が同じ）があれば置き換えて TTL を更新する */
  const addToCache = (...rows: readonly Row[]): StepEvent => {
    const sameRecord = (a: Row, b: Row) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
    cacheRows = [
      ...cacheRows.filter((cached) => !rows.some((row) => sameRecord(cached, row))),
      ...rows,
    ]
    return set(RESOLVER, CACHE, cacheOf(cacheRows))
  }

  // 以前の名前解決でキャッシュに残っているもの
  if (options.cache !== 'empty') {
    const preloaded =
      options.cache === 'answer' ? [...DELEGATION_ROWS, ROWS.wwwCached] : [...DELEGATION_ROWS]
    cacheRows = preloaded
    steps.push({
      id: 'cached',
      title: {
        en: 'The resolver already has some records cached',
        ja: 'リゾルバのキャッシュにはすでにレコードがある',
      },
      description:
        options.cache === 'answer'
          ? {
              en: 'An earlier lookup of www.example.com left the delegations for com. and example.com. and the address of www.example.com. in the cache. Each record stays until its TTL runs out: the www record was cached 55 seconds ago, so 245 of its 300 seconds remain.',
              ja: '以前に www.example.com を解決したので、com. と example.com. の委任と、www.example.com. のアドレスがキャッシュに残っている。各レコードは TTL が切れるまで残る。www のレコードは 55 秒前にキャッシュしたので、300 秒のうち残りは 245 秒。',
            }
          : {
              en: 'An earlier lookup of another name in example.com left the delegations for com. and example.com. in the cache, so the resolver already knows the example.com servers.',
              ja: '以前に example.com の別の名前を解決したので、com. と example.com. の委任がキャッシュに残っている。リゾルバは example.com のサーバーをすでに知っている。',
            },
      events: [set(RESOLVER, CACHE, cacheOf(preloaded))],
    })
  }

  steps.push({
    id: 'stub-query',
    title: { en: 'Your PC asks the resolver', ja: 'PC がリゾルバに問い合わせる' },
    description: {
      en: `An application wants the address of ${qname}. The stub resolver in your PC sends a recursive query (RD set) to the full-service resolver it is configured to use, and waits for the final answer.`,
      ja: `アプリケーションが ${qname} のアドレスを必要としている。PC のスタブリゾルバは、設定されているフルサービスリゾルバに再帰問い合わせ（RD あり）を送り、最終的な答えを待つ。`,
    },
    events: [
      send(
        query({
          id: 'stub-query',
          from: STUB,
          to: RESOLVER,
          dnsId: '0x2c1a',
          qname,
          recursive: true,
          destination: RESOLVER_ADDRESS,
        }),
      ),
    ],
  })

  const cachedAnswer = options.cache === 'answer' && options.name === 'www'
  if (!cachedAnswer) {
    if (options.cache === 'empty') {
      steps.push(
        {
          id: 'root-query',
          title: {
            en: 'The resolver asks a root server',
            ja: 'リゾルバがルートサーバーに問い合わせる',
          },
          description: {
            en: 'The cache is empty, so the resolver starts from the root. It knows the root servers’ addresses from its built-in list (root hints). (Many resolvers send only “com.” here to reveal less, known as QNAME minimisation; this page sends the full name for simplicity.)',
            ja: 'キャッシュが空なので、リゾルバはルートから始める。ルートサーバーのアドレスは、あらかじめ持っている一覧（ルートヒント）で知っている。（多くのリゾルバは、ここで「com.」だけを送って余計な情報を渡さない。QNAME minimisation と呼ぶ。このページでは簡単のため名前全体を送っている。）',
          },
          events: [
            send(
              query({
                id: 'root-query',
                from: RESOLVER,
                to: ROOT,
                dnsId: '0x7e01',
                qname,
                recursive: false,
                destination: ROOT_ADDRESS,
              }),
            ),
          ],
        },
        {
          id: 'root-referral',
          title: {
            en: 'The root refers the resolver to .com',
            ja: 'ルートが .com のサーバーを紹介する',
          },
          description: {
            en: 'The root does not know the answer, but it knows who is responsible for com. It replies with a referral: NS records for com. in the Authority section and their addresses (glue) in the Additional section. The resolver caches them.',
            ja: 'ルートは答えを知らないが、com. を担当するサーバーは知っている。Authority セクションに com. の NS レコード、Additional セクションにそのアドレス（glue）を入れた委任の応答を返す。リゾルバはそれをキャッシュする。',
          },
          events: [
            send(
              response({
                id: 'root-referral',
                from: ROOT,
                to: RESOLVER,
                dnsId: '0x7e01',
                label: 'Referral: com. NS',
                qname,
                flags: 'QR',
                rcode: 'NOERROR',
                authority: [ROWS.comNs],
                additional: [ROWS.tldGlue],
                description: {
                  en: 'A referral to the com. servers.',
                  ja: 'com. のサーバーへの委任。',
                },
                flagsDescription: {
                  en: 'QR: this is a response. No AA: the root is not authoritative for this name.',
                  ja: 'QR: 応答であることを示す。AA なし: ルートはこの名前の権威を持たない。',
                },
              }),
            ),
            addToCache(ROWS.comNs, ROWS.tldGlue),
          ],
        },
        {
          id: 'tld-query',
          title: {
            en: 'The resolver asks the .com server',
            ja: 'リゾルバが .com のサーバーに問い合わせる',
          },
          description: {
            en: `The resolver sends the same question to ${TLD_SERVER} (${TLD_ADDRESS}), the address it just learned from the glue.`,
            ja: `リゾルバは、glue で知ったばかりのアドレス ${TLD_ADDRESS}（${TLD_SERVER}）に同じ質問を送る。`,
          },
          events: [
            send(
              query({
                id: 'tld-query',
                from: RESOLVER,
                to: TLD,
                dnsId: '0x7e02',
                qname,
                recursive: false,
                destination: TLD_ADDRESS,
              }),
            ),
          ],
        },
        {
          id: 'tld-referral',
          title: {
            en: '.com refers the resolver to example.com',
            ja: '.com が example.com のサーバーを紹介する',
          },
          description: {
            en: 'The .com server replies with another referral: the name servers for example.com. (ns1 and ns2) and their addresses. Because those servers are inside example.com. itself, the glue addresses are needed to reach them. (The real example.com is served by other name servers; this page puts them inside the zone to show why glue exists.)',
            ja: '.com のサーバーは、example.com. のネームサーバー（ns1 と ns2）とそのアドレスを入れた委任の応答を返す。これらのサーバーは example.com. の中にあるので、たどり着くには glue のアドレスが必要になる。（実際の example.com は別のネームサーバーが担当している。このページでは glue の役割を見せるため、ゾーンの中に置いている。）',
          },
          events: [
            send(
              response({
                id: 'tld-referral',
                from: TLD,
                to: RESOLVER,
                dnsId: '0x7e02',
                label: 'Referral: example.com. NS',
                qname,
                flags: 'QR',
                rcode: 'NOERROR',
                authority: [ROWS.exampleNs1, ROWS.exampleNs2],
                additional: [ROWS.ns1Glue, ROWS.ns2Glue],
                description: {
                  en: 'A referral to the example.com. servers.',
                  ja: 'example.com. のサーバーへの委任。',
                },
                flagsDescription: {
                  en: 'QR: a response. No AA: the .com server delegates example.com. and is not authoritative for its names.',
                  ja: 'QR: 応答。AA なし: .com のサーバーは example.com. を委任しており、その中の名前の権威は持たない。',
                },
              }),
            ),
            addToCache(ROWS.exampleNs1, ROWS.exampleNs2, ROWS.ns1Glue, ROWS.ns2Glue),
          ],
        },
      )
    } else {
      steps.push({
        id: 'skip-to-auth',
        title: {
          en: 'The cache already knows the example.com servers',
          ja: 'キャッシュで example.com のサーバーがわかる',
        },
        description: {
          en: 'The delegation for example.com. is still in the cache, so the resolver skips the root and .com and goes straight to the example.com servers.',
          ja: 'example.com. の委任がまだキャッシュにあるので、リゾルバはルートと .com を飛ばして、example.com のサーバーに直接問い合わせる。',
        },
        events: [],
      })
    }

    // 権威サーバーへの問い合わせ（1 台目が応答しなければ、タイムアウト後に 2 台目へ）
    if (options.serverDown) {
      steps.push(
        {
          id: 'auth-query-ns1',
          title: {
            en: 'The resolver asks ns1, but gets no reply',
            ja: 'リゾルバが ns1 に問い合わせるが、応答がない',
          },
          description: {
            en: 'The resolver sends the question to ns1.example.com. The server is down (or the packet is lost), so no reply comes back.',
            ja: 'リゾルバは ns1.example.com に質問を送る。サーバーが止まっている（またはパケットが失われた）ので、応答は返ってこない。',
          },
          events: [
            send(
              query({
                id: 'auth-query-ns1',
                from: RESOLVER,
                to: AUTH,
                dnsId: '0x7e03',
                qname,
                recursive: false,
                lost: true,
                destination: NS1_ADDRESS,
              }),
            ),
          ],
        },
        {
          id: 'auth-query-ns2',
          title: {
            en: 'After a timeout, the resolver tries ns2',
            ja: 'タイムアウトの後、リゾルバが ns2 を試す',
          },
          description: {
            en: 'The resolver gives up waiting for ns1 and sends the same question to the other name server, ns2.example.com. Having more than one name server per zone is what makes this possible. How long to wait depends on the implementation and on the round-trip times it has measured; this page uses 1.5 seconds as an example.',
            ja: 'リゾルバは ns1 の応答を待つのをやめ、もう 1 台のネームサーバー ns2.example.com に同じ質問を送る。ゾーンごとにネームサーバーを複数置くのは、このためでもある。どれだけ待つかは、実装や計測した往復時間によって変わる。このページでは例として 1.5 秒にしている。',
          },
          events: [
            { kind: 'timer', actorId: RESOLVER, name: 'timeout', durationMs: QUERY_TIMEOUT_MS },
            send(
              query({
                id: 'auth-query-ns2',
                from: RESOLVER,
                to: AUTH,
                dnsId: '0x7e04',
                qname,
                recursive: false,
                destination: NS2_ADDRESS,
              }),
            ),
          ],
        },
      )
    } else {
      steps.push({
        id: 'auth-query',
        title: {
          en: 'The resolver asks the example.com server',
          ja: 'リゾルバが example.com のサーバーに問い合わせる',
        },
        description: {
          en: `The resolver sends the question to ${NS1} (${NS1_ADDRESS}), one of the authoritative servers for example.com.`,
          ja: `リゾルバは example.com の権威サーバーの 1 つ、${NS1}（${NS1_ADDRESS}）に質問を送る。`,
        },
        events: [
          send(
            query({
              id: 'auth-query',
              from: RESOLVER,
              to: AUTH,
              dnsId: '0x7e03',
              qname,
              recursive: false,
              destination: NS1_ADDRESS,
            }),
          ),
        ],
      })
    }

    const authDnsId = options.serverDown ? '0x7e04' : '0x7e03'
    if (options.name === 'missing') {
      steps.push({
        id: 'auth-answer',
        title: { en: 'The name does not exist (NXDOMAIN)', ja: '名前が存在しない（NXDOMAIN）' },
        description: {
          en: `The authoritative server answers with RCODE NXDOMAIN and puts the zone’s SOA record in the Authority section. The resolver caches this negative answer for min(SOA TTL, SOA MINIMUM) = ${NEGATIVE_TTL} seconds, so it will not ask again for a while. The cache entry means “this name does not exist for any type”; NXDOMAIN is a response code, not a record type.`,
          ja: `権威サーバーは RCODE NXDOMAIN で応え、Authority セクションにゾーンの SOA レコードを入れる。リゾルバはこの否定応答を min(SOA の TTL, SOA の MINIMUM) = ${NEGATIVE_TTL} 秒のあいだキャッシュし、しばらくは同じ問い合わせをしない。キャッシュの行は「この名前はどのタイプでも存在しない」という意味で、NXDOMAIN はレコードのタイプではなく応答コード。`,
        },
        events: [
          send(
            response({
              id: 'auth-answer',
              from: AUTH,
              to: RESOLVER,
              dnsId: authDnsId,
              label: 'NXDOMAIN',
              qname,
              flags: 'QR AA',
              rcode: 'NXDOMAIN',
              authority: [SOA_ROW],
              description: {
                en: 'An authoritative negative answer.',
                ja: '権威のある否定応答。',
              },
              flagsDescription: AUTHORITATIVE_FLAGS,
            }),
          ),
          addToCache(ROWS.missing),
        ],
      })
    } else {
      const answer: readonly Row[] = options.name === 'alias' ? [ROWS.alias, ROWS.www] : [ROWS.www]
      steps.push({
        id: 'auth-answer',
        title:
          options.name === 'alias'
            ? { en: 'The answer is an alias (CNAME)', ja: '答えは別名（CNAME）' }
            : { en: 'The authoritative server answers', ja: '権威サーバーが答える' },
        description:
          options.name === 'alias'
            ? {
                en: `${ALIAS} is an alias: its CNAME points to ${WWW}. Because that name is in the same zone, the server also includes its A record, so the resolver does not need to ask again. Both records are cached.`,
                ja: `${ALIAS} は別名で、CNAME が ${WWW} を指している。その名前は同じゾーンにあるので、サーバーは A レコードも一緒に返し、リゾルバは改めて問い合わせなくて済む。両方のレコードがキャッシュされる。`,
              }
            : {
                en: `The authoritative server knows the answer: ${WWW} A ${WWW_ADDRESS}. The AA flag says this comes from the server responsible for the zone. The resolver caches it for its TTL (${ANSWER_TTL} seconds).`,
                ja: `権威サーバーは答えを知っている: ${WWW} A ${WWW_ADDRESS}。AA フラグは、ゾーンを担当するサーバーからの答えであることを示す。リゾルバはこれを TTL（${ANSWER_TTL} 秒）のあいだキャッシュする。`,
              },
        events: [
          send(
            response({
              id: 'auth-answer',
              from: AUTH,
              to: RESOLVER,
              dnsId: authDnsId,
              label: options.name === 'alias' ? `Answer: CNAME ${WWW}` : `Answer: A ${WWW_ADDRESS}`,
              qname,
              flags: 'QR AA',
              rcode: 'NOERROR',
              answer,
              description: { en: 'An authoritative answer.', ja: '権威のある答え。' },
              flagsDescription: AUTHORITATIVE_FLAGS,
            }),
          ),
          addToCache(...answer),
        ],
      })
    }
  }

  // リゾルバからスタブへの応答
  const finalAnswer: readonly Row[] =
    options.name === 'www'
      ? [cachedAnswer ? ROWS.wwwCached : ROWS.www]
      : options.name === 'alias'
        ? [ROWS.alias, ROWS.www]
        : []
  steps.push({
    id: 'stub-answer',
    title: cachedAnswer
      ? { en: 'The resolver answers from its cache', ja: 'リゾルバがキャッシュから答える' }
      : options.name === 'missing'
        ? {
            en: 'The resolver reports that the name does not exist',
            ja: 'リゾルバが名前がないことを伝える',
          }
        : { en: 'The resolver returns the answer', ja: 'リゾルバが答えを返す' },
    description: cachedAnswer
      ? {
          en: 'The answer is still in the cache, so the resolver replies immediately without asking any other server. The TTL it passes on is the time remaining (245 of the original 300 seconds). No AA flag: the answer comes from a cache, not from the zone’s own server.',
          ja: '答えがまだキャッシュにあるので、リゾルバは他のサーバーに聞かずにすぐ応答する。渡す TTL は残り時間（元の 300 秒のうち 245 秒）。AA フラグはない: ゾーンのサーバーではなく、キャッシュからの答えだから。',
        }
      : options.name === 'missing'
        ? {
            en: 'The resolver passes NXDOMAIN on to your PC. The application sees an error such as “host not found”.',
            ja: 'リゾルバは NXDOMAIN を PC に伝える。アプリケーションには「ホストが見つからない」などのエラーとして見える。',
          }
        : {
            en: 'The resolver sends the final answer to your PC (RA: recursion available). The application can now connect to the address.',
            ja: 'リゾルバは最終的な答えを PC に送る（RA: 再帰が使える）。アプリケーションは、そのアドレスに接続できるようになる。',
          },
    events: [
      send(
        response({
          id: 'stub-answer',
          from: RESOLVER,
          to: STUB,
          dnsId: '0x2c1a',
          label:
            options.name === 'missing'
              ? 'NXDOMAIN'
              : options.name === 'alias'
                ? `Answer: CNAME ${WWW}`
                : `Answer: A ${WWW_ADDRESS}`,
          qname,
          flags: 'QR RD RA',
          rcode: options.name === 'missing' ? 'NXDOMAIN' : 'NOERROR',
          answer: finalAnswer,
          ...(options.name === 'missing' ? { authority: [SOA_ROW] } : {}),
          description: { en: 'The final answer for your PC.', ja: 'PC への最終的な答え。' },
          flagsDescription: {
            en: 'QR: a response. RD is copied from the query. RA: the resolver offers recursion. No AA: the resolver is not authoritative.',
            ja: 'QR: 応答。RD は問い合わせからそのまま写す。RA: リゾルバが再帰を引き受ける。AA なし: リゾルバは権威を持たない。',
          },
        }),
      ),
      set(STUB, RESULT, options.name === 'missing' ? 'NXDOMAIN' : WWW_ADDRESS),
    ],
  })
  return steps
}

export const dnsResolutionScenario: Scenario<DnsOptions> = {
  id: 'dns-resolution',
  title: { en: 'DNS name resolution', ja: 'DNS の名前解決' },
  actors,
  optionDefs: {
    cache: {
      kind: 'select',
      label: { en: 'Resolver cache', ja: 'リゾルバのキャッシュ' },
      description: {
        en: 'What the resolver already remembers from earlier lookups.',
        ja: '以前の名前解決で、リゾルバがすでに覚えているもの。',
      },
      choices: [
        { value: 'empty', label: { en: 'Empty', ja: '空' } },
        {
          value: 'delegation',
          label: { en: 'Knows the example.com servers', ja: 'example.com のサーバーを知っている' },
        },
        {
          value: 'answer',
          label: { en: 'Also knows www.example.com', ja: 'www.example.com の答えも知っている' },
        },
      ],
      defaultValue: 'empty',
    },
    name: {
      kind: 'select',
      label: { en: 'Name to look up', ja: '調べる名前' },
      choices: [
        { value: 'www', label: { en: 'www.example.com', ja: 'www.example.com' } },
        {
          value: 'missing',
          label: {
            en: 'no-such-host.example.com (does not exist)',
            ja: 'no-such-host.example.com（存在しない）',
          },
        },
        {
          value: 'alias',
          label: { en: 'shop.example.com (an alias)', ja: 'shop.example.com（別名）' },
        },
      ],
      defaultValue: 'www',
    },
    serverDown: {
      kind: 'toggle',
      label: {
        en: 'The first example.com server does not reply',
        ja: 'example.com の 1 台目のサーバーが応答しない',
      },
      description: {
        en: 'Has no effect when the answer comes from the cache.',
        ja: '答えがキャッシュにあるときは影響しない。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
