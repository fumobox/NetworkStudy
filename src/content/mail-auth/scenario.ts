/**
 * メールの送信ドメイン認証: SPF、DKIM、DMARC
 *
 * 根拠:
 * - RFC 5321 §3.3（SMTP のトランザクション: MAIL、RCPT、DATA）、§3.9.1（エイリアス: エンベロープの送信者は変えない）、
 *   §3.9.2（メーリングリスト: エンベロープの送信者をリストの管理者に変える）、§4.3.2（DATA の後の 550 は方針による拒否）、
 *   §4.4（Received）、§7.1（SMTP だけでは送信者を確かめられない）。RFC 5322 §3.6.2（From:）。RFC 3463 §3.8（5.7.1: 配送が許可されない）
 * - RFC 7208 §2.3、§2.4（HELO と MAIL FROM の識別子）、§2.6（結果: none、neutral、pass、fail、softfail、temperror、permerror）、
 *   §3.1（TXT レコードだけを使う）、§4.6.2（メカニズムは左から順に評価する）、§4.6.4（DNS を引く項は 10 個まで）、§5.1（all）、
 *   §5.6（ip4）、§8.4（fail の扱いは受信側が決める）
 * - RFC 6376 §3.1（セレクター）、§3.4（正規化）、§3.5（DKIM-Signature のタグ）、§3.6.2.1（公開鍵の名前 <selector>._domainkey.<d=>）、
 *   §5.4（From は必ず署名する）、§6（検証）。RFC 8301（rsa-sha1 は使わない。鍵は 1024 ビット以上）
 * - RFC 9989（DMARC。RFC 7489 を置き換えた）§3.2.10（relaxed と strict のアライメント）、§4.4.1、§4.4.2（DKIM と SPF の識別子。
 *   SPF は MAIL FROM だけを使う）、§4.7（p、sp、np、adkim、aspf、t、rua などのタグ）、§4.10（DNS のツリーウォーク）、§5.3.5（アラインした
 *   識別子が 1 つでも pass なら pass）、§5.3.6（ポリシーを当てるかは受信側の判断）、§5.4、§7.4（p=reject だけを理由に拒否してはいけない。ほかの根拠がなければ quarantine として扱う）、§7.1（SPF の -all で DMARC の前に拒否されることがある）、
 *   §7.2（DATA への 5xy で拒否する。例: 550 5.7.1）。RFC 9990（集約レポート）
 * - RFC 8601 §2.2、§2.7.1、§2.7.2（Authentication-Results と結果の名前）
 * - RFC 7960 §2.2（転送で SPF が壊れる）、§2.3（改変で DKIM が壊れる）、§3.2.1（エイリアス）、§3.2.3（メーリングリスト）。
 *   RFC 8617（ARC。Experimental）は触れるだけ
 *
 * 学習用の単純化: SMTP はフェーズごとに 1 つのメッセージで描く（実際はコマンドごとに応答がある）。EHLO の SPF、STARTTLS、MTA-STS、DANE、
 * BIMI は描かない。受信側は SPF の fail だけでは拒否せず、DMARC で判断する。受信側は DMARC のポリシーに従う（p=reject なら拒否する。RFC 9989 §7.4 はそれだけを理由にした拒否を禁じているが、実際には多い）。DKIM の l=、i=、x=、
 * 複数の署名は扱わない。DMARC の sp、np、t、失敗レポート、組織ドメインの判定（ツリーウォーク）は扱わず、識別子のドメインは、From の
 * ドメインと同じか、組織ドメインから違うかのどちらか（relaxed と strict で結果が変わる例はない）。転送サーバーは SRS を使わない。メーリングリストは自分の DKIM 署名を付けない。
 * example.net の MX の問い合わせは済んでいるものとする。DNS のレコードの p= は、オプションに合わせて変わる
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
  path: z.enum(['direct', 'spoof', 'forward', 'list']).catch('direct'),
  policy: z.enum(['reject', 'quarantine', 'none']).catch('reject'),
})
export type MailAuthOptions = z.infer<typeof optionsSchema>
type Path = MailAuthOptions['path']
type Policy = MailAuthOptions['policy']

const SENDER: ActorId = 'sender'
const OTHER: ActorId = 'other'
const RECEIVER: ActorId = 'receiver'
const DNS: ActorId = 'dns'

const SIGNING: StateKey = 'signing'
const IDENTITIES: StateKey = 'identities'
const DMARC: StateKey = 'dmarc'
const ACTION: StateKey = 'action'
const RESULTS: StateKey = 'results'
const RECORDS: StateKey = 'records'

export const IDENTITY_COLUMNS = ['Identifier', 'Domain', 'Result', 'Aligned'] as const
export const RECORD_COLUMNS = ['Name', 'TXT'] as const

export const ADDRESSES = {
  sender: '192.0.2.25',
  other: '203.0.113.66',
  receiver: '198.51.100.25',
} as const
const DKIM_KEY = 'v=DKIM1; k=rsa; p=MIIBIjANBg…'
const SPF_EXAMPLE_COM = 'v=spf1 ip4:192.0.2.25 -all'
const SPF_EXAMPLE_ORG = 'v=spf1 ip4:203.0.113.66 -all'
const DKIM_SIGNATURE =
  'v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.com; s=s1; h=from:to:subject:date; bh=…; b=…'

const actors: readonly Actor[] = [
  {
    id: SENDER,
    kind: 'server',
    name: {
      en: 'Sending server (mail.example.com, 192.0.2.25)',
      ja: '送信サーバー（mail.example.com、192.0.2.25）',
    },
    shortName: { en: 'mail.example.com', ja: 'mail.example.com' },
    stateSlots: [
      {
        key: SIGNING,
        label: { en: 'DKIM signing', ja: 'DKIM の署名' },
        initial: 'd=example.com; s=s1 (rsa-sha256)',
      },
    ],
  },
  {
    id: OTHER,
    kind: 'server',
    name: { en: 'Other server (203.0.113.66)', ja: 'ほかのサーバー（203.0.113.66）' },
    shortName: { en: 'Other server', ja: 'ほかのサーバー' },
    stateSlots: [],
  },
  {
    id: RECEIVER,
    kind: 'server',
    name: {
      en: 'Receiving server (mx.example.net, 198.51.100.25)',
      ja: '受信サーバー（mx.example.net、198.51.100.25）',
    },
    shortName: { en: 'mx.example.net', ja: 'mx.example.net' },
    stateSlots: [
      {
        key: IDENTITIES,
        label: { en: 'Checks', ja: '確かめた識別子' },
        initial: { columns: IDENTITY_COLUMNS, rows: [] },
      },
      { key: DMARC, label: { en: 'DMARC', ja: 'DMARC' }, initial: '-' },
      { key: ACTION, label: { en: 'Action', ja: '扱い' }, initial: '-' },
      {
        key: RESULTS,
        label: {
          en: 'Authentication-Results (added to the stored message)',
          ja: 'Authentication-Results（保存するメッセージに足す）',
        },
        initial: '-',
      },
    ],
  },
  {
    id: DNS,
    kind: 'resolver',
    name: {
      en: 'DNS resolver (used by mx.example.net)',
      ja: 'DNS リゾルバー（mx.example.net が使う）',
    },
    shortName: { en: 'DNS', ja: 'DNS' },
    stateSlots: [
      {
        key: RECORDS,
        label: { en: 'Published TXT records', ja: '公開されている TXT レコード' },
        initial: { columns: RECORD_COLUMNS, rows: [] },
      },
    ],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

type IdentityRow = readonly [string, string, string, string]
const identities = (...rows: IdentityRow[]): StateTable => ({ columns: IDENTITY_COLUMNS, rows })

/** 受信サーバーにつなぐサーバー */
const clientOf = (path: Path): ActorId => (path === 'direct' ? SENDER : OTHER)

interface SpfResult {
  readonly domain: string
  readonly result: 'pass' | 'fail'
}
function spfResult(path: Path): SpfResult {
  if (path === 'direct') return { domain: 'example.com', result: 'pass' }
  if (path === 'list') return { domain: 'example.org', result: 'pass' }
  return { domain: 'example.com', result: 'fail' }
}
type DkimResult = 'pass' | 'fail' | 'none'
function dkimResult(path: Path): DkimResult {
  if (path === 'spoof') return 'none'
  if (path === 'list') return 'fail'
  return 'pass'
}
const spfAligned = (path: Path) => {
  const spf = spfResult(path)
  return spf.result === 'pass' && spf.domain === 'example.com'
}
const dkimAligned = (path: Path) => dkimResult(path) === 'pass'
const dmarcPass = (path: Path) => spfAligned(path) || dkimAligned(path)

const alignment = (pass: boolean, aligned: boolean) => (pass ? (aligned ? 'yes' : 'no') : '-')

function spfRow(path: Path, withAlignment: boolean): IdentityRow {
  const spf = spfResult(path)
  return [
    'SPF (MAIL FROM)',
    spf.domain,
    spf.result,
    withAlignment ? alignment(spf.result === 'pass', spfAligned(path)) : '-',
  ]
}
function dkimRow(path: Path, withAlignment: boolean): IdentityRow {
  const dkim = dkimResult(path)
  return [
    'DKIM (d=)',
    dkim === 'none' ? '-' : 'example.com',
    dkim,
    withAlignment ? alignment(dkim === 'pass', dkimAligned(path)) : '-',
  ]
}

const dmarcRecord = (policy: Policy) => `v=DMARC1; p=${policy}; rua=mailto:dmarc@example.com`

function records(path: Path, policy: Policy): StateTable {
  const rows: (readonly [string, string])[] = [
    ['example.com', SPF_EXAMPLE_COM],
    ['s1._domainkey.example.com', DKIM_KEY],
    ['_dmarc.example.com', dmarcRecord(policy)],
  ]
  if (path === 'forward' || path === 'list') rows.push(['example.org', SPF_EXAMPLE_ORG])
  return { columns: RECORD_COLUMNS, rows }
}

function txtQuery(id: string, name: string): Message {
  return {
    id,
    from: RECEIVER,
    to: DNS,
    label: `Query TXT ${name}`,
    status: 'delivered',
    fields: [{ name: 'Question', value: `${name}. IN TXT` }],
  }
}
/** label は短くし、Answer にはレコードの全体を入れる */
function txtAnswer(id: string, txt: string, description: LocalizedText, full = txt): Message {
  return {
    id,
    from: DNS,
    to: RECEIVER,
    label: `TXT: ${txt}`,
    status: 'delivered',
    fields: [{ name: 'Answer', value: full, highlight: true, description }],
  }
}

const RECORDS_SECTION: LocalizedText = { en: 'Published records', ja: '公開されたレコード' }
const ENVELOPE_SECTION: LocalizedText = { en: 'SMTP envelope', ja: 'SMTP のエンベロープ' }
const MESSAGE_SECTION: LocalizedText = { en: 'Message (DATA)', ja: 'メッセージ（DATA）' }
const VERDICT_SECTION: LocalizedText = { en: 'Verdict', ja: '判定' }

function recordsStep(path: Path, policy: Policy): Step {
  return {
    id: 'records',
    section: RECORDS_SECTION,
    title: {
      en: 'example.com publishes its records in DNS',
      ja: 'example.com が DNS にレコードを公開している',
    },
    description: {
      en: `Alice (alice@example.com) writes to Bob (bob@example.net). The owner of example.com has published three TXT records: an SPF record listing the servers that may send its mail, the DKIM public key under the selector s1, and a DMARC policy saying what to do with mail that fails (here p=${policy}). A receiving server can look all of them up.${path === 'forward' || path === 'list' ? ' example.org publishes an SPF record for its own server, too.' : ''}`,
      ja: `Alice（alice@example.com）が Bob（bob@example.net）にメールを書く。example.com の所有者は、TXT レコードを 3 つ公開している。自分のメールを送ってよいサーバーを並べた SPF のレコード、セレクター s1 の下の DKIM の公開鍵、失敗したメールをどう扱ってほしいかを書いた DMARC のポリシー（ここでは p=${policy}）。受信サーバーはどれも引ける。${path === 'forward' || path === 'list' ? 'example.org も、自分のサーバーの SPF のレコードを公開している。' : ''}`,
    },
    events: [set(DNS, RECORDS, records(path, policy))],
  }
}

function handoffStep(path: 'forward' | 'list'): Step {
  const rcpt = path === 'forward' ? 'bob@example.org' : 'team@example.org'
  return {
    id: 'handoff',
    section: ENVELOPE_SECTION,
    title: {
      en: 'Alice’s mail first goes to example.org',
      ja: 'Alice のメールはまず example.org に届く',
    },
    description:
      path === 'forward'
        ? {
            en: 'Alice writes to Bob’s old address, bob@example.org. That address is an alias that forwards everything to bob@example.net. mail.example.com delivers the message to example.org’s server as usual, and SPF and DKIM pass there.',
            ja: 'Alice は Bob の古いアドレス bob@example.org に書く。このアドレスはエイリアスで、すべてを bob@example.net に転送する。mail.example.com はいつもどおり example.org のサーバーに配送し、そこでは SPF も DKIM も pass になる。',
          }
        : {
            en: 'Alice writes to the mailing list team@example.org, and Bob is one of its members. mail.example.com delivers the message to the list server at example.org as usual.',
            ja: 'Alice はメーリングリスト team@example.org に書き、Bob はそのメンバー。mail.example.com はいつもどおり example.org のリストのサーバーに配送する。',
          },
    events: [
      send({
        id: 'handoff-envelope',
        from: SENDER,
        to: OTHER,
        label: 'MAIL FROM:<alice@example.com>',
        status: 'delivered',
        fields: [
          { name: 'Client IP', value: ADDRESSES.sender },
          { name: 'MAIL FROM', value: '<alice@example.com>' },
          { name: 'RCPT TO', value: `<${rcpt}>` },
        ],
      }),
      send({
        id: 'handoff-data',
        from: SENDER,
        to: OTHER,
        label: 'DATA: From: alice@example.com',
        status: 'delivered',
        fields: [
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'To', value: rcpt },
          { name: 'DKIM-Signature', value: DKIM_SIGNATURE },
        ],
      }),
    ],
  }
}

function envelopeStep(path: Path): Step {
  const mailFrom = path === 'list' ? '<list-bounces@example.org>' : '<alice@example.com>'
  const ehlo = path === 'forward' || path === 'list' ? 'mail.example.org' : 'mail.example.com'
  const description: LocalizedText =
    path === 'direct'
      ? {
          en: 'mail.example.com connects to mx.example.net and opens an SMTP transaction: EHLO, MAIL FROM, RCPT TO. MAIL FROM is the envelope sender, where bounces go. It is not the From: line the reader sees; that comes later, inside the message.',
          ja: 'mail.example.com が mx.example.net につなぎ、SMTP のトランザクションを始める。EHLO、MAIL FROM、RCPT TO。MAIL FROM はエンベロープの送信者で、エラーの通知（バウンス）の宛先。読む人が見る From: ではない。それは後でメッセージの中に出てくる。',
        }
      : path === 'spoof'
        ? {
            en: 'A server that has nothing to do with example.com connects and claims to be sending Alice’s mail. SMTP itself checks nothing: any server can write any name in EHLO and any address in MAIL FROM.',
            ja: 'example.com と関係のないサーバーがつなぎ、Alice のメールを送ると名乗る。SMTP 自体は何も確かめない。どのサーバーでも、EHLO に好きな名前を、MAIL FROM に好きなアドレスを書ける。',
          }
        : path === 'forward'
          ? {
              en: 'example.org’s server now opens its own SMTP session to mx.example.net. An alias changes only the recipient: the envelope sender stays <alice@example.com>, but the connection comes from 203.0.113.66.',
              ja: 'example.org のサーバーが、自分で mx.example.net に SMTP でつなぐ。エイリアスが変えるのは受信者だけ。エンベロープの送信者は <alice@example.com> のままだが、接続は 203.0.113.66 から来る。',
            }
          : {
              en: 'The list server sends a copy to each member. A mailing list changes the envelope sender to its own bounce address, <list-bounces@example.org>, so that delivery errors go to the list, not to Alice.',
              ja: 'リストのサーバーが、メンバーそれぞれにコピーを送る。メーリングリストはエンベロープの送信者を自分のバウンスのアドレス <list-bounces@example.org> に変える。配送のエラーが Alice ではなくリストに届くように。',
            }
  return {
    id: 'envelope',
    section: ENVELOPE_SECTION,
    title: { en: 'The SMTP envelope: MAIL FROM', ja: 'SMTP のエンベロープ: MAIL FROM' },
    description,
    events: [
      send({
        id: 'envelope',
        from: clientOf(path),
        to: RECEIVER,
        label: `MAIL FROM:${mailFrom}`,
        status: 'delivered',
        description: {
          en: 'EHLO, MAIL FROM and RCPT TO drawn as one message; in reality each command gets its own reply.',
          ja: 'EHLO、MAIL FROM、RCPT TO を 1 つのメッセージで描いている。実際はコマンドごとに応答がある。',
        },
        fields: [
          {
            name: 'Client IP',
            value: path === 'direct' ? ADDRESSES.sender : ADDRESSES.other,
            highlight: true,
            description: {
              en: 'The address the connection actually comes from. This is what SPF checks',
              ja: '接続が実際に来ているアドレス。SPF はこれを確かめる',
            },
          },
          {
            name: 'EHLO',
            value: ehlo,
            description: {
              en: 'The name the client gives for itself. Only a claim',
              ja: 'クライアントが名乗る名前。名乗っているだけ',
            },
          },
          {
            name: 'MAIL FROM',
            value: mailFrom,
            highlight: true,
            description: {
              en: 'The envelope sender (RFC5321.MailFrom): where bounces go. SPF checks its domain',
              ja: 'エンベロープの送信者（RFC5321.MailFrom）。バウンスの宛先。SPF はこのドメインを確かめる',
            },
          },
          { name: 'RCPT TO', value: '<bob@example.net>' },
        ],
      }),
    ],
  }
}

function spfStep(path: Path): Step {
  const spf = spfResult(path)
  const ip = path === 'direct' ? ADDRESSES.sender : ADDRESSES.other
  const description: LocalizedText =
    path === 'direct'
      ? {
          en: 'SPF takes the domain of MAIL FROM (example.com) and fetches its SPF record. The mechanisms are tried from left to right: ip4:192.0.2.25 matches the connecting address, so the result is pass. Anything else would hit -all: fail. (~all would give softfail, ?all neutral; no record at all gives none.)',
          ja: 'SPF は MAIL FROM のドメイン（example.com）を取り、その SPF のレコードを引く。メカニズムは左から順に試す。ip4:192.0.2.25 が接続元のアドレスに一致するので、結果は pass。ほかのアドレスなら -all に当たって fail（~all なら softfail、?all なら neutral、レコードがなければ none）。',
        }
      : path === 'list'
        ? {
            en: 'MAIL FROM is now in example.org, so SPF checks example.org’s record, which lists the list server 203.0.113.66: pass. But it is a pass for example.org, not for example.com.',
            ja: 'MAIL FROM は example.org になったので、SPF は example.org のレコードを確かめる。リストのサーバー 203.0.113.66 が載っているので pass。ただしこれは example.org の pass で、example.com の pass ではない。',
          }
        : path === 'forward'
          ? {
              en: 'MAIL FROM still says example.com, but the connection comes from example.org’s server, which is not in example.com’s record: -all gives fail. Forwarding breaks SPF. This receiver does not reject on SPF alone; it leaves the decision to DMARC (some receivers do reject here on -all).',
              ja: 'MAIL FROM は example.com のままだが、接続は example.org のサーバーから来ていて、example.com のレコードに載っていない。-all で fail。転送は SPF を壊す。この受信サーバーは SPF だけでは拒否せず、DMARC に判断を任せる（ここで -all を理由に拒否する受信サーバーもある）。',
            }
          : {
              en: 'The domain of MAIL FROM is example.com, but 203.0.113.66 is not in its record: -all gives fail. This receiver does not reject on SPF alone; it leaves the decision to DMARC.',
              ja: 'MAIL FROM のドメインは example.com だが、203.0.113.66 はそのレコードに載っていない。-all で fail。この受信サーバーは SPF だけでは拒否せず、DMARC に判断を任せる。',
            }
  return {
    id: 'spf',
    section: ENVELOPE_SECTION,
    title: {
      en: `SPF: may ${ip} send for ${spf.domain}?`,
      ja: `SPF: ${ip} は ${spf.domain} のメールを送ってよいか`,
    },
    description,
    events: [
      send(txtQuery('spf-query', spf.domain)),
      send(
        txtAnswer('spf-answer', spf.domain === 'example.org' ? SPF_EXAMPLE_ORG : SPF_EXAMPLE_COM, {
          en: 'v=spf1 starts an SPF record. ip4: an authorized address. -all: everything else fails',
          ja: 'v=spf1 は SPF のレコードの始まり。ip4: 許可するアドレス。-all: それ以外はすべて fail',
        }),
      ),
      set(RECEIVER, IDENTITIES, identities(spfRow(path, false))),
    ],
  }
}

function dataStep(path: Path): Step {
  const fields: PacketField[] = [
    {
      name: 'From',
      value: 'Alice <alice@example.com>',
      highlight: true,
      description: {
        en: 'The author (RFC5322.From): the address the reader sees. DMARC protects this domain',
        ja: '作成者（RFC5322.From）。読む人が見るアドレス。DMARC はこのドメインを守る',
      },
    },
    {
      name: 'To',
      value:
        path === 'forward'
          ? 'bob@example.org'
          : path === 'list'
            ? 'team@example.org'
            : 'bob@example.net',
    },
    {
      name: 'Subject',
      value: path === 'list' ? '[team] Invoice for September' : 'Invoice for September',
      highlight: path === 'list',
    },
    { name: 'Date', value: 'Thu, 1 Oct 2026 09:00:00 +0900' },
    path === 'spoof'
      ? {
          name: 'DKIM-Signature',
          value: '(none)',
          highlight: true,
          description: {
            en: 'The attacker does not have example.com’s private key, so it cannot sign as d=example.com',
            ja: '攻撃者は example.com の秘密鍵を持たないので、d=example.com として署名できない',
          },
        }
      : {
          name: 'DKIM-Signature',
          value: DKIM_SIGNATURE,
          highlight: true,
          description: {
            en: 'd= the signing domain, s= the selector (which key), h= the signed header fields (From must be one), bh= the hash of the body, b= the signature, c= how headers and body are normalized before hashing',
            ja: 'd= 署名したドメイン、s= セレクター（どの鍵か）、h= 署名したヘッダー（From は必ず含む）、bh= 本文のハッシュ、b= 署名、c= ハッシュの前にヘッダーと本文をどう正規化するか',
          },
        },
  ]
  if (path === 'forward' || path === 'list') {
    fields.push({
      name: 'Received',
      value: 'from mail.example.com (192.0.2.25) by mail.example.org',
    })
  }
  if (path === 'list') fields.push({ name: 'List-Id', value: '<team.example.org>' })
  fields.push({
    name: 'Body',
    value:
      path === 'list'
        ? 'Please find the invoice attached.\n-- \nteam mailing list: https://lists.example.org/team'
        : 'Please find the invoice attached.',
    highlight: path === 'list',
  })
  const description: LocalizedText =
    path === 'direct'
      ? {
          en: 'After DATA come the header fields and the body. From: shows alice@example.com: this is the identity the reader trusts, and the one DMARC is about. mail.example.com signed the message with DKIM: the DKIM-Signature covers From, To, Subject and Date and a hash of the body.',
          ja: 'DATA の後に、ヘッダーと本文が続く。From: には alice@example.com とある。読む人が信じる識別子で、DMARC が守る対象。mail.example.com は DKIM で署名している。DKIM-Signature は From、To、Subject、Date と、本文のハッシュを覆う。',
        }
      : path === 'spoof'
        ? {
            en: 'The forged message also says From: alice@example.com, and the reader would see exactly that. But it carries no DKIM signature for example.com: without the private key, the attacker cannot make one.',
            ja: '偽のメッセージも From: alice@example.com と書いてあり、読む人にはそのまま見える。しかし example.com の DKIM の署名はない。秘密鍵がなければ、攻撃者は署名を作れない。',
          }
        : path === 'forward'
          ? {
              en: 'The forwarder passes the message on unchanged, only adding a Received header of its own, which is not covered by the signature. Alice’s DKIM-Signature is still intact.',
              ja: '転送サーバーは、自分の Received ヘッダーを足すだけで、メッセージを変えずに渡す。Received は署名の対象ではない。Alice の DKIM-Signature はそのまま。',
            }
          : {
              en: 'The list edits the message: it adds [team] to the Subject and a footer to the body. Alice’s original DKIM-Signature is still there, but it no longer matches what it covers.',
              ja: 'リストはメッセージを編集する。Subject に [team] を足し、本文にフッターを足す。Alice の元の DKIM-Signature は残っているが、もう覆っている内容と合わない。',
            }
  return {
    id: 'data',
    section: MESSAGE_SECTION,
    title: {
      en: 'DATA: the headers, including DKIM-Signature',
      ja: 'DATA: ヘッダーと DKIM-Signature',
    },
    description,
    events: [
      send({
        id: 'data',
        from: clientOf(path),
        to: RECEIVER,
        label: 'DATA: From: alice@example.com',
        status: 'delivered',
        fields,
      }),
    ],
  }
}

function dkimStep(path: Path): Step {
  const dkim = dkimResult(path)
  if (dkim === 'none') {
    return {
      id: 'dkim',
      section: MESSAGE_SECTION,
      title: { en: 'DKIM: no signature to check', ja: 'DKIM: 確かめる署名がない' },
      description: {
        en: 'There is no DKIM-Signature, so there is no key to fetch and nothing to verify: the DKIM result is none.',
        ja: 'DKIM-Signature がないので、取る鍵も確かめるものもない。DKIM の結果は none。',
      },
      events: [set(RECEIVER, IDENTITIES, identities(spfRow(path, false), dkimRow(path, false)))],
    }
  }
  return {
    id: 'dkim',
    section: MESSAGE_SECTION,
    title: {
      en: 'DKIM: fetch the public key and verify',
      ja: 'DKIM: 公開鍵を取って署名を確かめる',
    },
    description:
      dkim === 'pass'
        ? {
            en: `The receiver builds the key’s name from the signature: selector s1, the _domainkey label, and d=example.com, and fetches the public key. It hashes the body and compares it with bh=, then checks the signature b= over the listed header fields. Both match: pass.${path === 'forward' ? ' Forwarding did not change anything that was signed, so DKIM survives it.' : ''} Selectors let a domain have several keys and rotate them.`,
            ja: `受信サーバーは、署名から鍵の名前を作る。セレクター s1、_domainkey のラベル、d=example.com。そして公開鍵を取る。本文をハッシュして bh= と比べ、並べられたヘッダーに対する署名 b= を確かめる。どちらも合うので pass。${path === 'forward' ? '転送は署名したものを何も変えなかったので、DKIM は転送を生き延びる。' : ''}セレクターがあるので、ドメインは複数の鍵を持ち、入れ替えられる。`,
          }
        : {
            en: 'The receiver fetches the key and checks the signature, but the body hash no longer matches bh= (the footer was added), and the Subject changed. The signature is genuine, but it covers a message that no longer exists: fail.',
            ja: '受信サーバーは鍵を取って署名を確かめるが、本文のハッシュがもう bh= と合わない（フッターが足された）。Subject も変わった。署名は本物だが、もう存在しないメッセージを覆っている。fail。',
          },
    events: [
      send(txtQuery('dkim-query', 's1._domainkey.example.com')),
      send(
        txtAnswer('dkim-answer', DKIM_KEY, {
          en: 'v=DKIM1: a DKIM key record. k=rsa: the key type. p=: the public key (shortened here)',
          ja: 'v=DKIM1: DKIM の鍵のレコード。k=rsa: 鍵の種類。p=: 公開鍵（ここでは省略）',
        }),
      ),
      set(RECEIVER, IDENTITIES, identities(spfRow(path, false), dkimRow(path, false))),
    ],
  }
}

function dmarcStep(path: Path, policy: Policy): Step {
  const description: LocalizedText =
    path === 'direct'
      ? {
          en: 'DMARC starts from the domain of From: (example.com) and fetches the policy at _dmarc.example.com. Then it asks: did SPF or DKIM pass for a domain that is aligned with the From domain? By default the alignment is relaxed: the same organizational domain is enough, so mail.example.com would also align; strict (adkim=s, aspf=s) needs an exact match. Here both SPF and DKIM passed for example.com itself: DMARC pass.',
          ja: 'DMARC は From: のドメイン（example.com）から始め、_dmarc.example.com のポリシーを取る。そして、From のドメインとアラインしたドメインで SPF か DKIM が pass したかを問う。既定のアライメントは relaxed（緩やかな一致）で、組織ドメインが同じならよいので、mail.example.com でもアラインする。strict（adkim=s、aspf=s）は完全な一致が要る。ここでは SPF も DKIM も example.com そのもので pass した。DMARC は pass。',
        }
      : path === 'spoof'
        ? {
            en: 'SPF failed and there is no DKIM signature, so nothing passed for example.com: DMARC fail. (An attacker could use its own domain in MAIL FROM and get an SPF pass, but that domain would not be aligned with From: and would count for nothing.)',
            ja: 'SPF は fail で、DKIM の署名もないので、example.com で pass したものは何もない。DMARC は fail（攻撃者が MAIL FROM に自分のドメインを使えば SPF は pass するが、From: とアラインしないので何の役にも立たない）。',
          }
        : path === 'forward'
          ? {
              en: 'SPF failed, but DKIM passed with d=example.com, which is aligned with From:. One aligned pass is enough: DMARC pass. This is why domains that use DMARC should sign with DKIM.',
              ja: 'SPF は fail だが、DKIM は d=example.com で pass していて、From: とアラインしている。アラインした pass が 1 つあればよい。DMARC は pass。DMARC を使うドメインが DKIM で署名すべき理由がこれ。',
            }
          : {
              en: 'SPF passed, but for example.org, which is not aligned with example.com, so it counts for nothing. DKIM failed. No aligned pass: DMARC fail, although Alice really sent this message.',
              ja: 'SPF は pass したが example.org の pass で、example.com とアラインしないので何の役にも立たない。DKIM は fail。アラインした pass がないので DMARC は fail。Alice が本当に送ったメッセージなのに。',
            }
  return {
    id: 'dmarc',
    section: VERDICT_SECTION,
    title: {
      en: 'DMARC: policy lookup and alignment',
      ja: 'DMARC: ポリシーの取得とアライメント',
    },
    description,
    events: [
      send(txtQuery('dmarc-query', '_dmarc.example.com')),
      send(
        txtAnswer(
          'dmarc-answer',
          `v=DMARC1; p=${policy}`,
          {
            en: 'v=DMARC1: a DMARC policy record. p=: what the domain owner asks receivers to do with mail that fails (none, quarantine or reject). rua=: where to send aggregate reports (not shown in the label)',
            ja: 'v=DMARC1: DMARC のポリシーのレコード。p=: 失敗したメールを受信側にどう扱ってほしいか（none、quarantine、reject）。rua=: 集約レポートの送り先（ラベルでは省略）',
          },
          dmarcRecord(policy),
        ),
      ),
      set(
        RECEIVER,
        IDENTITIES,
        identities(spfRow(path, true), dkimRow(path, true), [
          'From (header)',
          'example.com',
          '-',
          '-',
        ]),
      ),
      set(RECEIVER, DMARC, dmarcPass(path) ? 'pass' : 'fail'),
    ],
  }
}

/** Authentication-Results の値（RFC 8601 §2.2。結果ごとに ; で区切る。authserv-id は省く） */
export function resultsHeader(path: Path): string {
  const spf = spfResult(path)
  const dkim = dkimResult(path)
  return [
    `spf=${spf.result} smtp.mailfrom=${spf.domain}`,
    dkim === 'none' ? 'dkim=none' : `dkim=${dkim} header.d=example.com`,
    `dmarc=${dmarcPass(path) ? 'pass' : 'fail'} header.from=example.com`,
  ].join('; ')
}

function verdictStep(path: Path, policy: Policy): Step {
  const to = clientOf(path)
  const accepted = dmarcPass(path) || policy !== 'reject'
  const action = dmarcPass(path)
    ? 'accept'
    : policy === 'none'
      ? 'accept (p=none)'
      : policy === 'quarantine'
        ? 'quarantine'
        : 'reject (550 5.7.1)'
  const reply: Message = accepted
    ? {
        id: 'reply',
        from: RECEIVER,
        to,
        label: '250 2.0.0 OK',
        status: 'delivered',
        fields: [{ name: 'Reply', value: '250 2.0.0 OK (queued)', highlight: true }],
      }
    : {
        id: 'reply',
        from: RECEIVER,
        to,
        label: '550 5.7.1 Rejected per DMARC policy',
        status: 'delivered',
        fields: [
          {
            name: 'Reply',
            value: '550 5.7.1 Email rejected per DMARC policy for example.com',
            highlight: true,
            description: {
              en: '5.7.1: delivery not authorized, message refused. The From domain is only known after DATA, so the refusal is the reply to the end of the message',
              ja: '5.7.1: 配送が許可されない。From のドメインは DATA の後でしかわからないので、拒否はメッセージの終わりへの応答になる',
            },
          },
        ],
      }
  const title: LocalizedText = dmarcPass(path)
    ? { en: 'Accepted: delivered to the inbox', ja: '受け入れ: 受信箱に配達' }
    : policy === 'none'
      ? {
          en: 'p=none: delivered anyway, and counted in the reports',
          ja: 'p=none: そのまま配達し、レポートに載る',
        }
      : policy === 'quarantine'
        ? {
            en: 'p=quarantine: accepted, but into the spam folder',
            ja: 'p=quarantine: 受け入れるが迷惑メールへ',
          }
        : {
            en: 'p=reject: refused at the end of DATA',
            ja: 'p=reject: DATA の最後で拒否',
          }
  const description: LocalizedText = dmarcPass(path)
    ? {
        en: `DMARC passed, so the policy does not apply and the message goes to Bob’s inbox. The receiver records the results in an Authentication-Results header.${path === 'forward' ? ' The SPF fail did no harm, thanks to the aligned DKIM pass.' : ''} Note that DMARC pass only means the From domain is genuine; it does not mean the mail is harmless (a look-alike domain can pass everything).`,
        ja: `DMARC が pass したので、ポリシーは当てはまらず、メッセージは Bob の受信箱に入る。受信サーバーは結果を Authentication-Results ヘッダーに記録する。${path === 'forward' ? 'SPF の fail は、アラインした DKIM の pass のおかげで害にならなかった。' : ''}DMARC の pass は From のドメインが本物だというだけで、メールが無害だという意味ではない（よく似たドメインなら、すべて pass しうる）。`,
      }
    : policy === 'none'
      ? {
          en: `p=none asks for monitoring only: the message is delivered as usual, and example.com’s owner learns about failures like this one from the aggregate reports that receivers send to rua= (summaries of all mail, sent periodically, whatever the policy). The receiver’s own spam filtering still applies.${path === 'list' ? ' Domain owners usually start with p=none to find legitimate mail, like this mailing list, that would fail.' : ''}`,
          ja: `p=none は監視だけを頼む。メッセージはいつもどおり配達され、example.com の所有者は、受信側が rua= に送る集約レポート（ポリシーにかかわらず、すべてのメールを定期的にまとめたもの）で、このような失敗を知る。受信サーバー自身の迷惑メールの判定は、そのまま働く。${path === 'list' ? 'ドメインの所有者は、このメーリングリストのように失敗する正当なメールを見つけるため、ふつう p=none から始める。' : ''}`,
        }
      : policy === 'quarantine'
        ? {
            en: 'p=quarantine asks receivers to treat failing mail as suspicious: this receiver accepts it but files it in Bob’s spam folder. How to apply a policy is always the receiver’s decision; this one follows it.',
            ja: 'p=quarantine は、失敗したメールを疑わしいものとして扱うよう頼む。この受信サーバーは受け入れるが、Bob の迷惑メールフォルダーに入れる。ポリシーをどう当てるかは、いつも受信側が決める。この受信サーバーはそれに従う。',
          }
        : {
            en: `p=reject asks receivers to refuse failing mail. The From domain is only known after DATA, so the refusal is the reply to the end of the message: 550 5.7.1.${path === 'spoof' ? ' The forged mail never reaches Bob.' : ' Alice’s real mail is refused too: this is the mailing-list problem. Lists usually rewrite From: to their own address; ARC (RFC 8617), which records the results the list saw, is an experimental alternative that only helps if the receiver trusts the list.'} Note that RFC 9989 says receivers must not reject on p=reject alone: without other evidence they must treat such mail as quarantine. Many receivers still reject, as this one does.`,
            ja: `p=reject は、失敗したメールを拒否するよう頼む。From のドメインは DATA の後でしかわからないので、拒否はメッセージの終わりへの応答になる。550 5.7.1。${path === 'spoof' ? '偽のメールは Bob に届かない。' : 'Alice の本物のメールも拒否される。これがメーリングリストの問題。リストはふつう From: を自分のアドレスに書き換える。リストが見た結果を記録する ARC（RFC 8617）は実験的な代わりの方法で、受信側がそのリストを信頼するときだけ役に立つ。'}なお RFC 9989 は、p=reject だけを理由に拒否してはいけないとし、ほかの根拠がなければ quarantine として扱わなければならないとしている。この受信サーバーのように、それでも拒否する受信側は多い。`,
          }
  const events: StepEvent[] = [send(reply), set(RECEIVER, ACTION, action)]
  if (accepted) events.push(set(RECEIVER, RESULTS, resultsHeader(path)))
  return { id: 'verdict', section: VERDICT_SECTION, title, description, events }
}

function buildSteps(options: MailAuthOptions): readonly Step[] {
  const { path, policy } = options
  return [
    recordsStep(path, policy),
    ...(path === 'forward' || path === 'list' ? [handoffStep(path)] : []),
    envelopeStep(path),
    spfStep(path),
    dataStep(path),
    dkimStep(path),
    dmarcStep(path, policy),
    verdictStep(path, policy),
  ]
}

export const mailAuthScenario: Scenario<MailAuthOptions> = {
  id: 'mail-auth',
  title: {
    en: 'Email authentication: SPF, DKIM and DMARC',
    ja: 'メールの送信ドメイン認証: SPF、DKIM、DMARC',
  },
  actors,
  optionDefs: {
    path: {
      kind: 'select',
      label: { en: 'How the mail arrives', ja: 'メールがどう届くか' },
      choices: [
        {
          value: 'direct',
          label: { en: 'Directly from mail.example.com', ja: 'mail.example.com から直接' },
        },
        {
          value: 'spoof',
          label: { en: 'Forged by another server', ja: 'ほかのサーバーがなりすます' },
        },
        {
          value: 'forward',
          label: {
            en: 'Forwarded unchanged by example.org',
            ja: 'example.org が変更せずに転送',
          },
        },
        {
          value: 'list',
          label: {
            en: 'Through a mailing list that edits it',
            ja: '内容を変えるメーリングリスト経由',
          },
        },
      ],
      defaultValue: 'direct',
    },
    policy: {
      kind: 'select',
      label: {
        en: 'DMARC policy of example.com (p=)',
        ja: 'example.com の DMARC ポリシー（p=）',
      },
      description: {
        en: 'Only changes the outcome when DMARC fails.',
        ja: 'DMARC が失敗したときだけ結果が変わる。',
      },
      choices: [
        { value: 'reject', label: { en: 'reject (refuse it)', ja: 'reject（拒否する）' } },
        {
          value: 'quarantine',
          label: { en: 'quarantine (spam folder)', ja: 'quarantine（迷惑メールへ）' },
        },
        { value: 'none', label: { en: 'none (monitor only)', ja: 'none（監視だけ）' } },
      ],
      defaultValue: 'reject',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
