/**
 * PROXY protocol の版 1（HAProxy Technologies, "The PROXY protocol Versions 1 & 2", 2020/03/05 版、§2.1）。
 * RFC ではない。L4 のロードバランサーが、バックエンドへの TCP の接続の最初に、元の送信元と宛先を 1 行の文字列で伝える。
 * 形は "PROXY" SP "TCP4" / "TCP6" SP 送信元 SP 宛先 SP 送信元ポート SP 宛先ポート CRLF で、最長 107 文字。
 * 受け手はこのヘッダーを受け取るよう設定されていなければならず、推測してはならない
 */

export interface ProxyV1Header {
  readonly family: 'TCP4' | 'TCP6'
  readonly source: string
  readonly destination: string
  readonly sourcePort: number
  readonly destinationPort: number
}

export const PROXY_V1_MAX_LENGTH = 107

const isPort = (port: number) => Number.isInteger(port) && port >= 0 && port <= 65535

/** CRLF を含む 1 行 */
export function proxyV1Line(header: ProxyV1Header): string {
  if (!isPort(header.sourcePort) || !isPort(header.destinationPort)) {
    throw new RangeError('port must be an integer from 0 to 65535')
  }
  const line = `PROXY ${header.family} ${header.source} ${header.destination} ${String(header.sourcePort)} ${String(header.destinationPort)}\r\n`
  if (line.length > PROXY_V1_MAX_LENGTH) {
    throw new RangeError('PROXY v1 line is longer than 107 characters')
  }
  return line
}
