import type { LocalizedText } from '@/lib/i18n/locale'

/** サブネット計算ツール（SubnetCalculator）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const SUBNET_TEXT = {
  title: { en: 'Subnet calculator', ja: 'サブネット計算' },
  address: { en: 'IPv4 address', ja: 'IPv4 アドレス' },
  addressHint: {
    en: 'Four numbers from 0 to 255, separated by dots (for example 192.168.1.10).',
    ja: '0〜255 の 4 つの数をドットで区切る（例: 192.168.1.10）。',
  },
  addressInvalid: {
    en: 'Not a valid IPv4 address. The results below are for the last valid address.',
    ja: 'IPv4 アドレスの形になっていない。下の結果は、最後に入力した正しいアドレスのもの。',
  },
  prefix: { en: 'Prefix length', ja: 'プレフィックス長' },
  prefixHint: {
    en: 'How many bits from the left are the network part (0 to 32).',
    ja: '左から何ビットがネットワーク部か（0〜32）。',
  },
  results: { en: 'Results', ja: '計算の結果' },
  rows: {
    cidr: { en: 'CIDR notation', ja: 'CIDR 表記' },
    mask: { en: 'Subnet mask', ja: 'サブネットマスク' },
    wildcard: { en: 'Wildcard mask', ja: 'ワイルドカードマスク' },
    network: { en: 'Network address', ja: 'ネットワークアドレス' },
    broadcast: { en: 'Broadcast address', ja: 'ブロードキャストアドレス' },
    firstHost: { en: 'First host', ja: '最初のホスト' },
    lastHost: { en: 'Last host', ja: '最後のホスト' },
    hostCount: { en: 'Usable hosts', ja: '使えるホストの数' },
    addressClass: { en: 'Address class (historical)', ja: 'アドレスクラス（旧来の分類）' },
    private: { en: 'Private address (RFC 1918)', ja: 'プライベートアドレス（RFC 1918）' },
  },
  noBroadcast: {
    en: 'None (/31 and /32 have no broadcast address)',
    ja: 'なし（/31 と /32 にはブロードキャストアドレスがない）',
  },
  hostCountNote: {
    en: 'All addresses minus the network and broadcast addresses. A /31 point-to-point link uses both of its addresses (RFC 3021), and a /32 is a single host.',
    ja: 'すべてのアドレスから、ネットワークアドレスとブロードキャストアドレスを除いた数。/31 のポイントツーポイントリンクは 2 つのアドレスを両方とも使い（RFC 3021）、/32 は 1 台だけ。',
  },
  yes: { en: 'Yes', ja: 'はい' },
  no: { en: 'No', ja: 'いいえ' },
  binary: { en: 'In binary', ja: '2 進数で見る' },
  binaryLead: {
    en: 'The mask has 1s for the network part and 0s for the host part. ANDing the address with the mask gives the network address.',
    ja: 'マスクはネットワーク部が 1、ホスト部が 0。アドレスとマスクの AND を取ると、ネットワークアドレスになる。',
  },
  networkPart: { en: 'Network part', ja: 'ネットワーク部' },
  hostPart: { en: 'Host part', ja: 'ホスト部' },
  binaryRows: {
    address: { en: 'Address', ja: 'アドレス' },
    mask: { en: 'Mask', ja: 'マスク' },
    network: { en: 'Network', ja: 'ネットワーク' },
  },
} satisfies Record<string, LocalizedText | Record<string, LocalizedText>>

/** 2 進表記の読み上げ用の説明 */
export function binarySplitText(networkBits: number): LocalizedText {
  const hostBits = 32 - networkBits
  return {
    en: `The first ${String(networkBits)} bits are the network part and the remaining ${String(hostBits)} bits are the host part.`,
    ja: `先頭の ${String(networkBits)} ビットがネットワーク部、残りの ${String(hostBits)} ビットがホスト部。`,
  }
}
