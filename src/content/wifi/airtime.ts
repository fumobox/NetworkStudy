/**
 * 5 GHz の OFDM（20 MHz 幅、802.11a と同じ non-HT）での時間の計算（IEEE Std 802.11-2024）
 *
 * - clause 17 "Orthogonal frequency division multiplexing (OFDM) PHY specification" の PHY の特性の表:
 *   aSlotTime 9 µs、aSIFSTime 16 µs、aCWmin 15、aCWmax 1023
 * - 17.4.3 "TXTIME calculation": TXTIME = T_PREAMBLE（16 µs）+ T_SIGNAL（4 µs）+ T_SYM（4 µs）×
 *   ⌈(16 + 8 × LENGTH + 6) / N_DBPS⌉。N_DBPS は 1 シンボルあたりのデータビット数（24 Mb/s なら 96）
 * - 10.3.2.3 "IFS": DIFS = aSIFSTime + 2 × aSlotTime。EDCA の AIFS[AC] = AIFSN[AC] × aSlotTime + aSIFSTime
 * - 10.3.3 "Random backoff time"、10.3.4.3 "Backoff procedure for DCF": バックオフは [0, CW] から一様に選んだスロット数。
 *   送信に失敗するたびに CW を 2 倍 + 1（上限 aCWmax）にし、成功したら aCWmin に戻す
 * - 9.2.4.2 "Duration/ID field": ユニキャストのデータの Duration は、続く SIFS と Ack の時間。RTS は CTS・データ・Ack と
 *   3 つの SIFS の時間、CTS は RTS の値から SIFS と CTS の時間を引いたもの
 */

export const SLOT_US = 9
export const SIFS_US = 16
export const DIFS_US = SIFS_US + 2 * SLOT_US
/** EDCA のベストエフォート（AIFSN 3）。概要で DCF の DIFS と比べる */
export const AIFS_BE_US = SIFS_US + 3 * SLOT_US
export const CW_MIN = 15
export const CW_MAX = 1023
/** 1 TU は 1024 µs。ビーコンの間隔は 100 TU が一般的 */
export const TU_US = 1024

/** 1 シンボルあたりのデータビット数（N_DBPS） */
const DATA_BITS_PER_SYMBOL = {
  6: 24,
  9: 36,
  12: 48,
  18: 72,
  24: 96,
  36: 144,
  48: 192,
  54: 216,
} as const
export type OfdmRate = keyof typeof DATA_BITS_PER_SYMBOL

/** 制御フレームの長さ（FCS を含む） */
export const ACK_BYTES = 14
export const CTS_BYTES = 14
export const RTS_BYTES = 20

/** MPDU の長さ。MAC ヘッダー 24、LLC/SNAP 8、FCS 4。保護するなら CCMP のヘッダー 8 と MIC 8 を足す */
export function dataMpduBytes(ipBytes: number, isProtected: boolean): number {
  return 24 + 8 + ipBytes + 4 + (isProtected ? 16 : 0)
}

export function ofdmTxTimeUs(bytes: number, rate: OfdmRate): number {
  const symbols = Math.ceil((16 + 8 * bytes + 6) / DATA_BITS_PER_SYMBOL[rate])
  return 16 + 4 + 4 * symbols
}

/** ユニキャストのデータの Duration（SIFS + Ack） */
export function dataDurationUs(rate: OfdmRate): number {
  return SIFS_US + ofdmTxTimeUs(ACK_BYTES, rate)
}

/** RTS の Duration（3 × SIFS + CTS + データ + Ack） */
export function rtsDurationUs(dataBytes: number, rate: OfdmRate): number {
  return (
    3 * SIFS_US +
    ofdmTxTimeUs(CTS_BYTES, rate) +
    ofdmTxTimeUs(dataBytes, rate) +
    ofdmTxTimeUs(ACK_BYTES, rate)
  )
}

/** CTS の Duration（RTS の Duration − SIFS − CTS） */
export function ctsDurationUs(rtsDuration: number, rate: OfdmRate): number {
  return rtsDuration - SIFS_US - ofdmTxTimeUs(CTS_BYTES, rate)
}

/** 送信に失敗したあとの CW（15 → 31 → 63 … 1023） */
export function nextCw(cw: number): number {
  return Math.min(2 * cw + 1, CW_MAX)
}
