/**
 * TLS 1.3 のハンドシェイク（フルハンドシェイク、1-RTT）とサーバー証明書の検証
 *
 * 根拠:
 * - RFC 8446 §2（概要と Figure 1）, §4.1.2 / §4.1.3（ClientHello / ServerHello）, §4.2（拡張: supported_versions,
 *   key_share, signature_algorithms, server_name（RFC 6066））, §4.3.1（EncryptedExtensions）, §4.4.2（Certificate）,
 *   §4.4.3（CertificateVerify）, §4.4.4（Finished）, §5.1（暗号化後のレコードの外側の型は application_data）,
 *   §6.2（エラーのアラート）, §7.1（鍵の階層）, 付録 A（状態機械）
 * - RFC 5280 §6（証明書パスの検証）, RFC 9525（サーバーの名前の確認）
 * 日付・名前・鍵は学習用の値。検証する時刻は 2026-10-01 とする
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

export const tlsOptionsSchema = z.object({
  certProblem: z
    .enum(['none', 'expired', 'nameMismatch', 'unknownCa', 'missingIntermediate'])
    .catch('none'),
})
export type TlsOptions = z.infer<typeof tlsOptionsSchema>
export type CertProblem = TlsOptions['certProblem']

const CLIENT: ActorId = 'client'
const SERVER: ActorId = 'server'
const STATE: StateKey = 'state'
const SEND_KEYS: StateKey = 'sendKeys'
export const CERT_CHAIN: StateKey = 'certChain'
const ALERT: StateKey = 'alert'

const HOST = 'www.example.com'
export const VALIDATION_DATE = '2026-10-01'

/** 証明書チェーンの表の列。CertChainPanel はこの列名で値を読む */
export const CERT_CHAIN_COLUMNS = [
  'Certificate',
  'Issuer',
  'Not after',
  'SAN',
  'Signature',
  'Validity',
  'Name',
  'Trust',
] as const
export const CHECK_OK = '✓'
export const CHECK_NG = '✗'
export const NOT_CHECKED = '-'
export const NOT_SENT = '(not sent)'

type ChainRow = readonly [string, string, string, string, string, string, string, string]

const SECTIONS = {
  plaintext: { en: 'Not encrypted', ja: '暗号化なし' },
  handshake: {
    en: 'Encrypted with the handshake traffic keys',
    ja: 'ハンドシェイク用の鍵で暗号化',
  },
  application: {
    en: 'Encrypted with the application traffic keys',
    ja: 'アプリケーション用の鍵で暗号化',
  },
} satisfies Record<string, LocalizedText>

const actors: readonly Actor[] = [
  {
    id: CLIENT,
    kind: 'client',
    name: { en: 'Client (browser)', ja: 'クライアント（ブラウザ）' },
    shortName: { en: 'Client', ja: 'クライアント' },
    stateSlots: [
      {
        key: STATE,
        label: { en: 'Handshake state', ja: 'ハンドシェイクの状態' },
        initial: 'START',
      },
      { key: SEND_KEYS, label: { en: 'Keys for sending', ja: '送信に使う鍵' }, initial: 'none' },
      {
        key: CERT_CHAIN,
        label: { en: 'Certificate chain check', ja: '証明書チェーンの検証' },
        initial: { columns: CERT_CHAIN_COLUMNS, rows: [] },
      },
      { key: ALERT, label: { en: 'Alert sent', ja: '送ったアラート' }, initial: '-' },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: `Server (${HOST})`, ja: `サーバー（${HOST}）` },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: STATE,
        label: { en: 'Handshake state', ja: 'ハンドシェイクの状態' },
        initial: 'START',
      },
      { key: SEND_KEYS, label: { en: 'Keys for sending', ja: '送信に使う鍵' }, initial: 'none' },
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

/** 暗号化されたレコードに共通のフィールド（外側の型は application_data に見える） */
function recordField(inner: string): PacketField {
  return {
    name: 'Record type',
    value: `application_data (inner: ${inner})`,
    description: {
      en: 'After ServerHello every record looks like application_data from the outside; the real type is inside the encrypted part.',
      ja: 'ServerHello より後のレコードは、外から見るとすべて application_data。本当の種類は暗号化された中身に入っている。',
    },
  }
}

const clientHello: Message = {
  id: 'client-hello',
  from: CLIENT,
  to: SERVER,
  label: 'ClientHello',
  status: 'delivered',
  description: {
    en: 'The client offers what it supports and sends its half of the key exchange right away.',
    ja: 'クライアントが対応している方式を示し、鍵交換の自分の分をすぐに送る。',
  },
  fields: [
    {
      name: 'legacy_version',
      value: '0x0303 (TLS 1.2)',
      description: {
        en: 'Kept at TLS 1.2 for compatibility. The real version is negotiated in supported_versions.',
        ja: '互換性のため TLS 1.2 のまま。本当のバージョンは supported_versions で決める。',
      },
    },
    {
      name: 'random',
      value: '32 random bytes',
      description: {
        en: 'Fresh random value for this handshake',
        ja: 'このハンドシェイク用の新しい乱数',
      },
    },
    {
      name: 'cipher_suites',
      value: 'TLS_AES_128_GCM_SHA256\nTLS_AES_256_GCM_SHA384\nTLS_CHACHA20_POLY1305_SHA256',
      description: {
        en: 'Encryption and hash algorithms the client can use, in order of preference',
        ja: 'クライアントが使える暗号とハッシュの組み合わせ（希望の順）',
      },
    },
    {
      name: 'supported_versions',
      value: 'TLS 1.3 (0x0304)',
      highlight: true,
      description: { en: 'The client asks for TLS 1.3', ja: 'クライアントは TLS 1.3 を希望する' },
    },
    {
      name: 'key_share',
      value: 'x25519: client public key',
      highlight: true,
      description: {
        en: 'The client’s Diffie-Hellman public key, sent in advance so the handshake takes only one round trip',
        ja: 'クライアントの Diffie-Hellman の公開鍵。前もって送っておくので、ハンドシェイクが 1 往復で済む',
      },
    },
    {
      name: 'signature_algorithms',
      value: 'ecdsa_secp256r1_sha256\nrsa_pss_rsae_sha256',
      description: {
        en: 'Signature algorithms the client accepts for the server’s CertificateVerify and certificates',
        ja: 'サーバーの CertificateVerify や証明書で受け入れられる署名の方式',
      },
    },
    {
      name: 'server_name',
      value: HOST,
      highlight: true,
      description: {
        en: 'SNI: the name the client wants to reach. The server picks the matching certificate, and the client later checks the certificate against this name.',
        ja: 'SNI: クライアントが接続したい名前。サーバーはそれに合う証明書を選び、クライアントはあとで証明書をこの名前と照らし合わせる。',
      },
    },
  ],
}

const serverHello: Message = {
  id: 'server-hello',
  from: SERVER,
  to: CLIENT,
  label: 'ServerHello',
  status: 'delivered',
  description: {
    en: 'The server picks the parameters and sends its half of the key exchange. After this, both sides can compute the handshake keys.',
    ja: 'サーバーが使う方式を選び、鍵交換の自分の分を送る。これで両者はハンドシェイク用の鍵を計算できる。',
  },
  fields: [
    {
      name: 'cipher_suite',
      value: 'TLS_AES_128_GCM_SHA256',
      highlight: true,
      description: { en: 'The suite chosen by the server', ja: 'サーバーが選んだ組み合わせ' },
    },
    {
      name: 'supported_versions',
      value: 'TLS 1.3 (0x0304)',
      highlight: true,
      description: { en: 'The server agrees to TLS 1.3', ja: 'サーバーは TLS 1.3 に合意する' },
    },
    {
      name: 'key_share',
      value: 'x25519: server public key',
      highlight: true,
      description: {
        en: 'The server’s public key. Combined with the client’s, it gives a shared secret that nobody watching can compute.',
        ja: 'サーバーの公開鍵。クライアントの公開鍵と組み合わせると、盗聴者には計算できない共有の秘密が得られる。',
      },
    },
  ],
}

function encrypted(
  message: Omit<Message, 'encrypted' | 'fields'> & {
    fields: readonly PacketField[]
    inner: string
  },
): Message {
  const { inner, fields, ...rest } = message
  return { ...rest, encrypted: true, fields: [recordField(inner), ...fields] }
}

const encryptedExtensions = encrypted({
  id: 'encrypted-extensions',
  from: SERVER,
  to: CLIENT,
  label: 'EncryptedExtensions',
  status: 'delivered',
  inner: 'handshake',
  description: {
    en: 'The rest of the server’s answers to the client’s extensions, now encrypted.',
    ja: 'クライアントの拡張への残りの答え。ここから暗号化される。',
  },
  fields: [
    {
      name: 'application_layer_protocol_negotiation',
      value: 'h2',
      description: {
        en: 'The application protocol to use over this connection (HTTP/2)',
        ja: 'この接続で使うアプリケーションのプロトコル（HTTP/2）',
      },
    },
  ],
})

const certificateVerify = encrypted({
  id: 'certificate-verify',
  from: SERVER,
  to: CLIENT,
  label: 'CertificateVerify',
  status: 'delivered',
  inner: 'handshake',
  description: {
    en: 'A signature that proves the server holds the private key for the certificate it sent.',
    ja: 'サーバーが、送った証明書の秘密鍵を持っていることを示す署名。',
  },
  fields: [
    {
      name: 'algorithm',
      value: 'ecdsa_secp256r1_sha256',
      description: { en: 'Signature algorithm', ja: '署名の方式' },
    },
    {
      name: 'signature',
      value: 'signature over the handshake so far',
      highlight: true,
      description: {
        en: 'Made with the server’s private key over a hash of all handshake messages so far. The client checks it with the public key in the certificate.',
        ja: 'ここまでのハンドシェイクのメッセージ全体のハッシュに、サーバーの秘密鍵で署名したもの。クライアントは証明書の公開鍵で確かめる。',
      },
    },
  ],
})

function finished(from: ActorId): Message {
  return encrypted({
    id: from === SERVER ? 'server-finished' : 'client-finished',
    from,
    to: from === SERVER ? CLIENT : SERVER,
    label: 'Finished',
    status: 'delivered',
    inner: 'handshake',
    description: {
      en: 'A MAC over the whole handshake. It proves that both sides saw the same messages and derived the same keys.',
      ja: 'ハンドシェイク全体に対する MAC。両者が同じメッセージを見て、同じ鍵を導いたことを確かめる。',
    },
    fields: [
      {
        name: 'verify_data',
        value: 'HMAC(finished_key, transcript hash)',
        highlight: true,
        description: {
          en: 'If anyone had changed a handshake message, this value would not match.',
          ja: 'だれかがハンドシェイクのメッセージを書き換えていれば、この値が一致しない。',
        },
      },
    ],
  })
}

interface CertSet {
  sent: readonly string[]
  rows: readonly ChainRow[]
  checked: readonly ChainRow[]
}

const LEAF_ISSUER = 'Example Intermediate CA'
const ROOT = 'Example Root CA'

/** 問題の種類ごとの証明書と検証結果（RFC 5280 §6 のパス検証と、名前の確認） */
function certificatesFor(problem: CertProblem): CertSet {
  const leafNotAfter = problem === 'expired' ? '2026-08-31' : '2027-03-31'
  const leafSan = problem === 'nameMismatch' ? 'other.example.net' : HOST
  const intermediateIssuer = problem === 'unknownCa' ? 'Unknown Root CA' : ROOT
  const root = problem === 'unknownCa' ? 'Unknown Root CA' : ROOT
  const pending = [NOT_CHECKED, NOT_CHECKED, NOT_CHECKED, NOT_CHECKED] as const
  const leaf = [HOST, LEAF_ISSUER, leafNotAfter, leafSan] as const
  const intermediate =
    problem === 'missingIntermediate'
      ? ([LEAF_ISSUER, NOT_SENT, NOT_SENT, NOT_CHECKED] as const)
      : ([LEAF_ISSUER, intermediateIssuer, '2031-06-30', NOT_CHECKED] as const)
  const rootRow = [root, root, '2036-01-01', NOT_CHECKED] as const
  const ok = CHECK_OK
  const ng = CHECK_NG
  const na = NOT_CHECKED
  // [Signature, Validity, Name, Trust]
  const leafChecks =
    problem === 'expired'
      ? [ok, ng, ok, na]
      : problem === 'nameMismatch'
        ? [ok, ok, ng, na]
        : problem === 'missingIntermediate'
          ? [ng, ok, ok, na]
          : [ok, ok, ok, na]
  const intermediateChecks = problem === 'missingIntermediate' ? [na, na, na, na] : [ok, ok, na, na]
  const rootChecks =
    problem === 'unknownCa'
      ? [na, ok, na, ng]
      : problem === 'missingIntermediate'
        ? [na, na, na, na]
        : [na, ok, na, ok]
  const row = (
    base: readonly [string, string, string, string],
    checks: readonly string[],
  ): ChainRow => [
    base[0],
    base[1],
    base[2],
    base[3],
    checks[0] ?? na,
    checks[1] ?? na,
    checks[2] ?? na,
    checks[3] ?? na,
  ]
  return {
    sent: problem === 'missingIntermediate' ? [HOST] : [HOST, LEAF_ISSUER],
    rows: [row(leaf, pending), row(intermediate, pending), row(rootRow, pending)],
    checked: [
      row(leaf, leafChecks),
      row(intermediate, intermediateChecks),
      row(rootRow, rootChecks),
    ],
  }
}

const ALERTS = {
  expired: { description: 'certificate_expired', code: 45 },
  nameMismatch: { description: 'certificate_unknown', code: 46 },
  unknownCa: { description: 'unknown_ca', code: 48 },
  missingIntermediate: { description: 'unknown_ca', code: 48 },
} as const

const VALIDATION_TEXT = {
  none: {
    title: {
      en: 'The client checks the certificate chain',
      ja: 'クライアントが証明書チェーンを確かめる',
    },
    description: {
      en: `The client builds a path from the server certificate to a root it trusts: each certificate must be signed by the next one and valid on ${VALIDATION_DATE}, the server certificate must be issued for ${HOST} (its SAN), and the root must be in the client’s trust store. Every check passes.`,
      ja: `クライアントは、サーバー証明書から信頼しているルートまでの道筋を組み立てる。各証明書が次の証明書で署名されていて、${VALIDATION_DATE} に有効であること、サーバー証明書が ${HOST} に対して発行されていること（SAN）、ルートが自分の信頼ストアにあることを確かめる。すべて合格。`,
    },
  },
  expired: {
    title: { en: 'The server certificate has expired', ja: 'サーバー証明書の期限が切れている' },
    description: {
      en: `The server certificate was valid only until 2026-08-31, but the check is made on ${VALIDATION_DATE}. An expired certificate cannot be trusted, so the check fails.`,
      ja: `サーバー証明書の有効期限は 2026-08-31 までだが、確かめているのは ${VALIDATION_DATE}。期限切れの証明書は信頼できないので、検証は失敗する。`,
    },
  },
  nameMismatch: {
    title: {
      en: 'The certificate is for a different name',
      ja: '証明書が別の名前のものになっている',
    },
    description: {
      en: `The certificate is valid and properly signed, but its SAN is other.example.net, not ${HOST} (the name the client asked for in server_name). The client cannot be sure it is talking to the right server, so the check fails.`,
      ja: `証明書は有効で、署名も正しい。しかし SAN は other.example.net で、クライアントが server_name で求めた ${HOST} ではない。正しい相手と話しているか確かめられないので、検証は失敗する。`,
    },
  },
  unknownCa: {
    title: {
      en: 'The chain ends at a root the client does not trust',
      ja: 'チェーンの行き着く先が、信頼していないルート',
    },
    description: {
      en: 'The signatures and dates are fine, but the chain leads to “Unknown Root CA”, which is not in the client’s trust store (for example, a self-made CA). Without a trusted root, the check fails.',
      ja: '署名も日付も問題ないが、チェーンの行き着く先の「Unknown Root CA」がクライアントの信頼ストアにない（自前で作った CA など）。信頼できるルートがないので、検証は失敗する。',
    },
  },
  missingIntermediate: {
    title: { en: 'The intermediate certificate is missing', ja: '中間証明書が送られてこない' },
    description: {
      en: 'The server sent only its own certificate. The client does not have “Example Intermediate CA”, so it cannot check the signature on the server certificate or build a path to a trusted root. (Some browsers try to fetch the missing certificate on their own, but many clients simply fail.)',
      ja: 'サーバーは自分の証明書しか送ってこなかった。クライアントは「Example Intermediate CA」を持っていないので、サーバー証明書の署名を確かめられず、信頼できるルートへの道筋も組み立てられない。（足りない証明書を自分で取りに行くブラウザもあるが、多くのクライアントはそのまま失敗する。）',
    },
  },
} satisfies Record<CertProblem, { title: LocalizedText; description: LocalizedText }>

function buildSteps(options: TlsOptions): readonly Step[] {
  const problem = options.certProblem
  const certs = certificatesFor(problem)
  const steps: Step[] = [
    {
      id: 'client-hello',
      section: SECTIONS.plaintext,
      title: { en: 'The client sends ClientHello', ja: 'クライアントが ClientHello を送る' },
      description: {
        en: 'The TCP connection is already open. The client lists what it supports (TLS 1.3, cipher suites, signature algorithms), the name it wants to reach (SNI), and already includes its key share, guessing that the server will accept x25519.',
        ja: 'TCP の接続はすでに開いている。クライアントは対応している方式（TLS 1.3、暗号の組み合わせ、署名の方式）と接続したい名前（SNI）を示し、サーバーが x25519 を受け入れると見込んで、鍵交換の自分の分も最初から入れておく。',
      },
      events: [set(CLIENT, STATE, 'WAIT_SH'), send(clientHello)],
    },
    {
      id: 'server-hello',
      section: SECTIONS.plaintext,
      title: { en: 'The server replies with ServerHello', ja: 'サーバーが ServerHello を返す' },
      description: {
        en: 'The server picks TLS 1.3 and TLS_AES_128_GCM_SHA256 and sends its key share. From the two key shares, both sides compute the same shared secret and derive the handshake traffic keys. Everything after this message is encrypted.',
        ja: 'サーバーは TLS 1.3 と TLS_AES_128_GCM_SHA256 を選び、鍵交換の自分の分を送る。2 つの鍵交換の値から、両者は同じ共有の秘密を計算し、ハンドシェイク用の鍵を導く。このメッセージより後は、すべて暗号化される。',
      },
      events: [
        set(SERVER, STATE, 'NEGOTIATED'),
        send(serverHello),
        set(SERVER, SEND_KEYS, 'handshake'),
        set(CLIENT, STATE, 'WAIT_EE'),
        set(CLIENT, SEND_KEYS, 'handshake'),
      ],
    },
    {
      id: 'encrypted-extensions',
      section: SECTIONS.handshake,
      title: { en: 'EncryptedExtensions', ja: 'EncryptedExtensions' },
      description: {
        en: 'The server sends the rest of its answers (for example, that HTTP/2 will be used). From the outside, only the size of the encrypted record is visible.',
        ja: 'サーバーが残りの答え（たとえば HTTP/2 を使うこと）を送る。外から見えるのは、暗号化されたレコードの大きさだけ。',
      },
      events: [send(encryptedExtensions), set(CLIENT, STATE, 'WAIT_CERT_CR')],
    },
    {
      id: 'certificate',
      section: SECTIONS.handshake,
      title: { en: 'The server sends its certificates', ja: 'サーバーが証明書を送る' },
      description: {
        en:
          problem === 'missingIntermediate'
            ? 'The server sends only its own certificate for www.example.com. It should also have sent the intermediate CA certificate that signed it.'
            : 'The server sends its own certificate for www.example.com, followed by the intermediate CA certificate that signed it. The root certificate is not sent: the client must already have it.',
        ja:
          problem === 'missingIntermediate'
            ? 'サーバーは www.example.com の自分の証明書だけを送る。本来は、それに署名した中間 CA の証明書も送るべきだった。'
            : 'サーバーは www.example.com の自分の証明書と、それに署名した中間 CA の証明書を送る。ルート証明書は送らない。クライアントがあらかじめ持っているはずだから。',
      },
      events: [
        send(
          encrypted({
            id: 'certificate',
            from: SERVER,
            to: CLIENT,
            label: 'Certificate',
            status: problem === 'none' ? 'delivered' : 'rejected',
            inner: 'handshake',
            description: {
              en: 'The server’s certificate chain (leaf first).',
              ja: 'サーバーの証明書チェーン（サーバー自身の証明書が先頭）。',
            },
            fields: [
              {
                name: 'certificate_list',
                value: certs.sent.join('\n'),
                highlight: true,
                description: {
                  en: 'Each certificate is signed by the next one. The root is not included.',
                  ja: '各証明書は次の証明書で署名されている。ルートは含めない。',
                },
              },
            ],
          }),
        ),
        set(CLIENT, CERT_CHAIN, { columns: CERT_CHAIN_COLUMNS, rows: certs.rows }),
        set(CLIENT, STATE, 'WAIT_CV'),
      ],
    },
    {
      id: 'validate-chain',
      section: SECTIONS.handshake,
      title: VALIDATION_TEXT[problem].title,
      description: VALIDATION_TEXT[problem].description,
      events: [set(CLIENT, CERT_CHAIN, { columns: CERT_CHAIN_COLUMNS, rows: certs.checked })],
    },
  ]

  if (problem !== 'none') {
    const alert = ALERTS[problem]
    steps.push(
      {
        id: 'alert',
        section: SECTIONS.handshake,
        title: {
          en: `The client aborts with a ${alert.description} alert`,
          ja: `クライアントが ${alert.description} のアラートで中断する`,
        },
        description: {
          en: `The client sends a fatal alert and closes the connection. The server had already sent CertificateVerify and Finished in the same flight, but the client does not process them.${problem === 'nameMismatch' ? ' (Which alert is sent for a name mismatch varies between implementations; browsers show an error such as NET::ERR_CERT_COMMON_NAME_INVALID.)' : ''}`,
          ja: `クライアントは致命的なアラートを送って接続を閉じる。サーバーは CertificateVerify と Finished をすでに同じまとまりで送っているが、クライアントはそれらを処理しない。${problem === 'nameMismatch' ? '（名前の不一致でどのアラートを送るかは実装によって違う。ブラウザは NET::ERR_CERT_COMMON_NAME_INVALID のようなエラーを表示する。）' : ''}`,
        },
        events: [
          send(
            encrypted({
              id: 'alert',
              from: CLIENT,
              to: SERVER,
              label: `Alert: ${alert.description}`,
              status: 'delivered',
              inner: 'alert',
              description: {
                en: 'A fatal alert. In TLS 1.3, alerts after ServerHello are encrypted too.',
                ja: '致命的なアラート。TLS 1.3 では、ServerHello より後のアラートも暗号化される。',
              },
              fields: [
                {
                  name: 'AlertDescription',
                  value: `${alert.description} (${String(alert.code)})`,
                  highlight: true,
                  description: {
                    en: 'Why the handshake failed (RFC 8446 §6.2)',
                    ja: 'ハンドシェイクが失敗した理由（RFC 8446 §6.2）',
                  },
                },
              ],
            }),
          ),
          // サーバーは CertificateVerify と Finished まで送り終え、クライアントの Finished を待っている
          set(SERVER, SEND_KEYS, 'application'),
          set(SERVER, STATE, 'WAIT_FINISHED'),
          set(CLIENT, ALERT, alert.description),
          set(CLIENT, STATE, 'CLOSED'),
        ],
      },
      {
        id: 'closed',
        section: SECTIONS.handshake,
        title: { en: 'The connection is closed', ja: '接続が閉じられる' },
        description: {
          en: 'The server receives the alert and closes the connection too. No application data was exchanged, and the browser shows a certificate error instead of the page.',
          ja: 'サーバーもアラートを受け取って接続を閉じる。アプリケーションのデータは一切やり取りされず、ブラウザはページの代わりに証明書のエラーを表示する。',
        },
        events: [set(SERVER, STATE, 'CLOSED')],
      },
    )
    return steps
  }

  steps.push(
    {
      id: 'certificate-verify',
      section: SECTIONS.handshake,
      title: {
        en: 'CertificateVerify proves the private key',
        ja: 'CertificateVerify で秘密鍵を持っていることを示す',
      },
      description: {
        en: 'A certificate is public, so anyone could send a copy. The server signs the handshake so far with its private key, and the client checks the signature with the public key in the certificate. Now the client knows it is talking to the owner of the certificate.',
        ja: '証明書は公開情報なので、だれでもコピーを送れてしまう。サーバーはここまでのハンドシェイクに秘密鍵で署名し、クライアントは証明書の公開鍵でその署名を確かめる。これで、証明書の持ち主と話していることがわかる。',
      },
      events: [send(certificateVerify), set(CLIENT, STATE, 'WAIT_FINISHED')],
    },
    {
      id: 'server-finished',
      section: SECTIONS.handshake,
      title: { en: 'The server sends Finished', ja: 'サーバーが Finished を送る' },
      description: {
        en: 'The server sends a MAC over the whole handshake and switches to the application traffic keys for sending. It now waits for the client’s Finished.',
        ja: 'サーバーはハンドシェイク全体に対する MAC を送り、送信に使う鍵をアプリケーション用に切り替える。あとはクライアントの Finished を待つ。',
      },
      events: [
        send(finished(SERVER)),
        set(SERVER, SEND_KEYS, 'application'),
        set(SERVER, STATE, 'WAIT_FINISHED'),
      ],
    },
    {
      id: 'client-finished',
      section: SECTIONS.handshake,
      title: { en: 'The client sends Finished', ja: 'クライアントが Finished を送る' },
      description: {
        en: 'The client checks the server’s Finished, sends its own (still with the handshake keys), and switches to the application traffic keys. The client is now CONNECTED. This took one round trip from the client’s first message.',
        ja: 'クライアントはサーバーの Finished を確かめ、自分の Finished を（まだハンドシェイク用の鍵で）送り、アプリケーション用の鍵に切り替える。クライアントは CONNECTED になる。最初のメッセージから 1 往復で済んだ。',
      },
      events: [
        send(finished(CLIENT)),
        set(CLIENT, SEND_KEYS, 'application'),
        set(CLIENT, STATE, 'CONNECTED'),
      ],
    },
    {
      id: 'application-data',
      section: SECTIONS.application,
      title: {
        en: 'Encrypted application data flows',
        ja: '暗号化されたアプリケーションのデータが流れる',
      },
      description: {
        en: 'The server checks the client’s Finished and is CONNECTED too. The browser’s HTTP request now travels encrypted with the application traffic keys.',
        ja: 'サーバーもクライアントの Finished を確かめて CONNECTED になる。ブラウザの HTTP の要求は、アプリケーション用の鍵で暗号化されて送られる。',
      },
      events: [
        set(SERVER, STATE, 'CONNECTED'),
        send(
          encrypted({
            id: 'application-data',
            from: CLIENT,
            to: SERVER,
            label: 'Application Data',
            status: 'delivered',
            inner: 'application_data',
            description: {
              en: 'An HTTP/2 request, protected by TLS.',
              ja: 'TLS で保護された HTTP/2 の要求。',
            },
            fields: [
              {
                name: 'content',
                value: 'GET / (HTTP/2)',
                highlight: true,
                description: {
                  en: 'Only the two endpoints can read this.',
                  ja: 'これを読めるのは両端の 2 者だけ。',
                },
              },
            ],
          }),
        ),
      ],
    },
  )
  return steps
}

export const tlsHandshakeScenario: Scenario<TlsOptions> = {
  id: 'tls-handshake',
  title: { en: 'TLS 1.3 handshake and certificates', ja: 'TLS 1.3 のハンドシェイクと証明書' },
  actors,
  optionDefs: {
    certProblem: {
      kind: 'select',
      label: { en: 'Server certificate', ja: 'サーバーの証明書' },
      description: {
        en: 'See how the client reacts to common certificate problems.',
        ja: 'よくある証明書の問題に、クライアントがどう反応するかを確かめる。',
      },
      choices: [
        { value: 'none', label: { en: 'No problem', ja: '問題なし' } },
        { value: 'expired', label: { en: 'Expired', ja: '期限切れ' } },
        {
          value: 'nameMismatch',
          label: { en: 'Issued for a different name', ja: '別の名前に対して発行されている' },
        },
        {
          value: 'unknownCa',
          label: { en: 'Issued by an untrusted CA', ja: '信頼していない CA が発行している' },
        },
        {
          value: 'missingIntermediate',
          label: { en: 'Intermediate certificate not sent', ja: '中間証明書が送られてこない' },
        },
      ],
      defaultValue: 'none',
    },
  },
  parseOptions: (raw) => tlsOptionsSchema.parse(raw),
  buildSteps,
}
