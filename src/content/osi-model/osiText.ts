import type { LocalizedText } from '@/lib/i18n/locale'
import type { Side, UnitId } from './steps'

/** OSI 参照モデルのステップ実行（OsiWalkthrough）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const OSI_TEXT = {
  title: { en: 'Walkthrough: sending a web request', ja: 'ステップ実行: Web の要求を送る' },
  sides: {
    sender: { en: 'Sender (your PC)', ja: '送信側（PC）' },
    receiver: { en: 'Receiver (web server)', ja: '受信側（Web サーバー）' },
  } satisfies Record<Side, LocalizedText>,
  current: { en: ' (current step)', ja: '（今のステップ）' },
  carried: { en: 'What is being carried', ja: '運ばれているもの' },
  onWire: {
    en: 'Sent as electrical signals (bits) on the cable',
    ja: 'ケーブルの電気信号（ビット）として送られる',
  },
  added: { en: ' (added)', ja: '（付いた）' },
  removed: { en: ' (removed)', ja: '（外した）' },
  units: {
    eth: { en: 'Ethernet header', ja: 'Ethernet のヘッダー' },
    ip: { en: 'IP header', ja: 'IP のヘッダー' },
    tcp: { en: 'TCP header', ja: 'TCP のヘッダー' },
    http: { en: 'HTTP data', ja: 'HTTP のデータ' },
    fcs: { en: 'FCS (trailer)', ja: 'FCS（トレーラー）' },
  } satisfies Record<UnitId, LocalizedText>,
  unitDetails: {
    eth: { en: 'MAC addresses, type 0x0800', ja: 'MAC アドレス、種類 0x0800' },
    ip: { en: '192.168.1.10 → 192.0.2.10', ja: '192.168.1.10 → 192.0.2.10' },
    tcp: { en: 'Port 49152 → 80, Seq, Ack', ja: 'ポート 49152 → 80、Seq、Ack' },
    http: { en: 'GET / HTTP/1.1', ja: 'GET / HTTP/1.1' },
    fcs: { en: 'CRC-32', ja: 'CRC-32' },
  } satisfies Record<UnitId, LocalizedText>,
} as const

/** 層の番号（`Layer 4` / `第 4 層`） */
export function layerLabel(number: number): LocalizedText {
  return { en: `Layer ${String(number)}`, ja: `第 ${String(number)} 層` }
}
