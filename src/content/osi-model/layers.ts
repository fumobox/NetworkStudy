/**
 * OSI 参照モデルの 7 層と、TCP/IP モデルの 4 層との対応。
 *
 * 根拠:
 * - ISO/IEC 7498-1（OSI 参照モデル）: 7 層の名前と役割
 * - RFC 1122 §1.1.3（Internet Protocol Suite）: TCP/IP の層（Application、Transport、Internet、Link）
 */
import type { ProtocolTerm } from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

export const LAYER_NUMBERS = [7, 6, 5, 4, 3, 2, 1] as const
export type LayerNumber = (typeof LAYER_NUMBERS)[number]

export const TCPIP_LAYERS = ['application', 'transport', 'internet', 'link'] as const
export type TcpIpLayer = (typeof TCPIP_LAYERS)[number]

export interface OsiLayer {
  readonly number: LayerNumber
  readonly name: LocalizedText
  readonly role: LocalizedText
  /** この層で扱うデータの単位（PDU） */
  readonly pdu: LocalizedText
  /** この例（Web ページの要求）で、この層を担うもの */
  readonly example: ProtocolTerm
  readonly tcpIp: TcpIpLayer
}

export const TCPIP_LAYER_NAMES: Readonly<Record<TcpIpLayer, LocalizedText>> = {
  application: { en: 'Application', ja: 'アプリケーション層' },
  transport: { en: 'Transport', ja: 'トランスポート層' },
  internet: { en: 'Internet', ja: 'インターネット層' },
  link: { en: 'Link', ja: 'リンク層' },
}

/** 上（第 7 層）から下（第 1 層）の順 */
export const OSI_LAYERS: readonly OsiLayer[] = [
  {
    number: 7,
    name: { en: 'Application', ja: 'アプリケーション層' },
    role: {
      en: 'The protocol the application speaks',
      ja: 'アプリケーションが話すプロトコル',
    },
    pdu: { en: 'Data', ja: 'データ' },
    example: 'HTTP',
    tcpIp: 'application',
  },
  {
    number: 6,
    name: { en: 'Presentation', ja: 'プレゼンテーション層' },
    role: {
      en: 'How the data is represented (character encoding, compression, encryption)',
      ja: 'データの表現（文字コード、圧縮、暗号化）',
    },
    pdu: { en: 'Data', ja: 'データ' },
    example: 'UTF-8',
    tcpIp: 'application',
  },
  {
    number: 5,
    name: { en: 'Session', ja: 'セッション層' },
    role: {
      en: 'Starting, keeping, and ending a conversation',
      ja: '対話の開始・維持・終了',
    },
    pdu: { en: 'Data', ja: 'データ' },
    // TCP/IP では独立した層がなく、アプリケーション（HTTP の接続の管理など）が受け持つ
    example: '(HTTP)',
    tcpIp: 'application',
  },
  {
    number: 4,
    name: { en: 'Transport', ja: 'トランスポート層' },
    role: {
      en: 'Delivery between applications (ports), reliability, and order',
      ja: 'アプリケーションどうしの配送（ポート）、信頼性、順序',
    },
    pdu: { en: 'Segment', ja: 'セグメント' },
    example: 'TCP',
    tcpIp: 'transport',
  },
  {
    number: 3,
    name: { en: 'Network', ja: 'ネットワーク層' },
    role: {
      en: 'Delivery between hosts across networks (IP addresses, routing)',
      ja: 'ネットワークをまたいだホストどうしの配送（IP アドレス、経路制御）',
    },
    pdu: { en: 'Packet', ja: 'パケット' },
    example: 'IPv4',
    tcpIp: 'internet',
  },
  {
    number: 2,
    name: { en: 'Data link', ja: 'データリンク層' },
    role: {
      en: 'Delivery to the next device on the same link (MAC addresses), error detection',
      ja: '同じリンクの隣の機器への配送（MAC アドレス）、誤りの検出',
    },
    pdu: { en: 'Frame', ja: 'フレーム' },
    example: 'Ethernet',
    tcpIp: 'link',
  },
  {
    number: 1,
    name: { en: 'Physical', ja: '物理層' },
    role: {
      en: 'Turning bits into signals on the cable or radio',
      ja: 'ビットをケーブルや電波の信号にする',
    },
    pdu: { en: 'Bits', ja: 'ビット' },
    example: '1000BASE-T',
    tcpIp: 'link',
  },
]

export function osiLayer(number: LayerNumber): OsiLayer {
  const layer = OSI_LAYERS.find((candidate) => candidate.number === number)
  if (layer === undefined) {
    throw new Error(`unknown OSI layer ${String(number)}`)
  }
  return layer
}
