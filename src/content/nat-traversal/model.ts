/**
 * NAT 越えのシナリオの土台: NAT の対応づけとフィルタリングの模型（RFC 4787 §4.1、§5）と、STUN・TURN のメッセージの組み立て。
 * NAT の表とパケットが届くかどうかをここで計算し、シナリオ（scenario.ts）の手書きの値とずれないようにする
 */
import type { ActorId, Message, PacketField, StateTable } from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { decodeXorAddress, hex, hex16, messageLength, xorAddress } from './stun'

export const NAT_COLUMNS = ['Proto', 'Internal', 'External', 'Remote'] as const

export type Proto = 'UDP' | 'TCP'
export type NatRow = readonly [Proto, string, string, string]

/** RFC 4787 の対応づけの動き。EIM: 宛先によらない。APDM: 宛先のアドレスとポートごと */
export type Mapping = 'EIM' | 'APDM'

export const endpoint = (ip: string, port: number) => `${ip}:${String(port)}`

/** 家庭などの NAT。フィルタリングはどれも APDF（宛先のアドレスとポートごと） */
export class Nat {
  readonly rows: NatRow[] = []
  private nextPort: number

  readonly publicIp: string
  readonly mapping: Mapping

  constructor(publicIp: string, mapping: Mapping, firstPort: number) {
    this.publicIp = publicIp
    this.mapping = mapping
    this.nextPort = firstPort
  }

  /** 内から外へのパケット: 対応を探すか作り、外側のアドレスを返す（RFC 4787 §4.1） */
  out(proto: Proto, internal: string, remote: string): string {
    const same = this.rows.find(
      ([p, i, , r]) => p === proto && i === internal && (this.mapping === 'EIM' || r === remote),
    )
    const external = same?.[2] ?? endpoint(this.publicIp, this.nextPort++)
    if (
      !this.rows.some(
        ([p, i, e, r]) => p === proto && i === internal && e === external && r === remote,
      )
    ) {
      this.rows.push([proto, internal, external, remote])
    }
    return external
  }

  /** 外から内へのパケットを通すか（APDF: 宛先の外側のアドレスに、送信元あての対応があるときだけ。RFC 4787 §5） */
  allows(proto: Proto, external: string, remote: string): boolean {
    return this.rows.some(([p, , e, r]) => p === proto && e === external && r === remote)
  }

  /** 外側のアドレスに対応する内側のアドレス */
  internalOf(proto: Proto, external: string): string | undefined {
    return this.rows.find(([p, , e]) => p === proto && e === external)?.[1]
  }

  table(): StateTable {
    return { columns: NAT_COLUMNS, rows: this.rows.map((row) => [...row]) }
  }
}

/** STUN の属性（名前、表示する値、値の長さ） */
export interface Attribute {
  readonly name: string
  readonly value: string
  /** 値の長さ（詰め物を含まない）。Message Length の計算に使う */
  readonly length: number
  readonly highlight?: boolean
  readonly description?: LocalizedText
}

/** XOR で運ぶアドレスの属性。受け取った値と、元に戻した値の両方を見せる */
export function xorAttribute(
  name: string,
  ip: string,
  port: number,
  description?: LocalizedText,
): Attribute {
  const bytes = xorAddress(ip, port)
  const decoded = decodeXorAddress(bytes)
  const attribute: Attribute = {
    name,
    value: `${hex(bytes)} → ${endpoint(decoded.ip, decoded.port)}`,
    length: 8,
    highlight: true,
  }
  return description === undefined ? attribute : { ...attribute, description }
}

export interface StunSpec {
  readonly type: number
  readonly typeName: string
  readonly transactionId: string
  readonly attributes: readonly Attribute[]
}

/** STUN のメッセージのフィールド（型、長さ、マジッククッキー、トランザクション ID、属性） */
export function stunFields(spec: StunSpec): PacketField[] {
  return [
    {
      name: 'Message Type',
      value: `${hex16(spec.type)} (${spec.typeName})`,
      description: {
        en: 'The method (Binding, Allocate, …) and the class (request, indication, success, error) packed into 14 bits',
        ja: 'メソッド（Binding、Allocate など）とクラス（要求、通知、成功、エラー）を 14 ビットに詰めたもの',
      },
    },
    {
      name: 'Message Length',
      value: String(messageLength(spec.attributes.map((a) => a.length))),
      description: {
        en: 'The length of the attributes in bytes, without the 20-byte header. Always a multiple of 4',
        ja: '属性の長さ（バイト）。20 バイトのヘッダーは含まない。いつも 4 の倍数',
      },
    },
    {
      name: 'Magic Cookie',
      value: '0x2112a442',
      description: {
        en: 'A fixed value that marks the packet as STUN and is used to XOR the addresses',
        ja: 'STUN のパケットだと示す決まった値。アドレスの XOR にも使う',
      },
    },
    {
      name: 'Transaction ID',
      value: `0x${spec.transactionId}`,
      description: {
        en: '96 random bits chosen by the sender of a request or indication; a response carries the same value as its request (this page uses example values)',
        ja: '要求や通知を送る側が選ぶ 96 ビットの乱数。応答には要求と同じ値が入る（このページの値は例）',
      },
    },
    ...spec.attributes.map((attribute): PacketField => {
      const field: PacketField = { name: attribute.name, value: attribute.value }
      return {
        ...field,
        ...(attribute.highlight === true ? { highlight: true } : {}),
        ...(attribute.description === undefined ? {} : { description: attribute.description }),
      }
    }),
  ]
}

/** 長期の資格情報の属性（401 の後の要求。RFC 8489 §9.2.4、RFC 8656 §20 の値） */
export const CREDENTIALS: readonly Attribute[] = [
  { name: 'USERNAME', value: 'alice', length: 5 },
  { name: 'REALM', value: 'example.com', length: 11 },
  { name: 'NONCE', value: 'obMatJos2gAAAadl7W7PeDU4hKE72jda', length: 32 },
  { name: 'PASSWORD-ALGORITHMS', value: 'MD5, SHA-256', length: 8 },
  { name: 'PASSWORD-ALGORITHM', value: 'SHA-256', length: 4 },
  {
    name: 'MESSAGE-INTEGRITY-SHA256',
    value: '(32 bytes)',
    length: 32,
    description: {
      en: 'HMAC-SHA256 over the message, keyed with SHA-256(username:realm:password). Older clients (RFC 5389) use MESSAGE-INTEGRITY with HMAC-SHA1 instead',
      ja: 'SHA-256(ユーザー名:レルム:パスワード) を鍵にした、メッセージの HMAC-SHA256。古いクライアント（RFC 5389）は代わりに HMAC-SHA1 の MESSAGE-INTEGRITY を使う',
    },
  },
]

export const INTEGRITY_SHA256: Attribute = {
  name: 'MESSAGE-INTEGRITY-SHA256',
  value: '(32 bytes)',
  length: 32,
}

export interface HopSpec {
  readonly id: string
  readonly from: ActorId
  readonly to: ActorId
  readonly label: string
  readonly src: string
  readonly dst: string
  readonly transport: string
  readonly fields: readonly PacketField[]
  readonly status?: Message['status']
  readonly translation?: string
  readonly encrypted?: boolean
}

/** 1 区間のメッセージ（NAT を越えるたびに、アドレスを書き換えた別のメッセージとして描く） */
export function hop(spec: HopSpec): Message {
  const fields: PacketField[] = [
    { name: 'IP Src → Dst', value: `${spec.src} → ${spec.dst}` },
    { name: 'Transport', value: spec.transport },
  ]
  if (spec.translation !== undefined) {
    fields.push({
      name: 'Translation',
      value: spec.translation,
      highlight: true,
      description: {
        en: 'What the NAT rewrote in the IP and UDP/TCP headers. The payload is not touched',
        ja: 'NAT が IP と UDP・TCP のヘッダーで書き換えたところ。中身には触れない',
      },
    })
  }
  fields.push(...spec.fields)
  const message: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields,
  }
  return spec.encrypted === true ? { ...message, encrypted: true } : message
}
