/**
 * OSI 参照モデルのカプセル化のステップ。例は、PC のブラウザーが Web サーバーに HTTP の GET を送るところ
 * （HTTP/1.1 over TCP / IPv4 / Ethernet。暗号化しない HTTP で、層ごとのヘッダーを見やすくする）。
 *
 * 根拠:
 * - RFC 9112 §3（HTTP/1.1 の要求行）
 * - RFC 9293 §3.1（TCP ヘッダー）、RFC 791 §3.1（IPv4 ヘッダー。Protocol = 6 は TCP）
 * - IEEE 802.3（Ethernet のフレーム。EtherType 0x0800 は IPv4、FCS は CRC-32）
 */
import type { Step } from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import type { LayerNumber } from './layers'

/** カプセル化で付くヘッダー・トレーラーとデータ（フレームの左から右の順） */
export const UNIT_IDS = ['eth', 'ip', 'tcp', 'http', 'fcs'] as const
export type UnitId = (typeof UNIT_IDS)[number]

export const SIDES = ['sender', 'receiver'] as const
export type Side = (typeof SIDES)[number]

export interface OsiStep {
  readonly id: string
  readonly title: LocalizedText
  readonly description: LocalizedText
  readonly side: Side
  /** このステップで働く層（プレゼンテーション層とセッション層は 1 つのステップにまとめる） */
  readonly layers: readonly LayerNumber[]
  /** このステップの後に運ばれている単位（UNIT_IDS の順） */
  readonly stack: readonly UnitId[]
  /** このステップで付いた（送信側）・外れた（受信側）もの */
  readonly changed: readonly UnitId[]
  /** 物理層で信号になっているか */
  readonly onWire: boolean
}

const DATA: readonly UnitId[] = ['http']
const SEGMENT: readonly UnitId[] = ['tcp', 'http']
const PACKET: readonly UnitId[] = ['ip', 'tcp', 'http']
const FRAME: readonly UnitId[] = ['eth', 'ip', 'tcp', 'http', 'fcs']

export const OSI_STEPS: readonly OsiStep[] = [
  {
    id: 'send-7',
    side: 'sender',
    layers: [7],
    stack: DATA,
    changed: ['http'],
    onWire: false,
    title: {
      en: 'Layer 7: the browser writes an HTTP request',
      ja: '第 7 層: ブラウザーが HTTP の要求を書く',
    },
    description: {
      en: 'The browser asks the web server for the page with an HTTP request (GET / HTTP/1.1). This is the data that the lower layers carry. The application only cares about HTTP; it does not know how the data will travel.',
      ja: 'ブラウザーは HTTP の要求（GET / HTTP/1.1）で Web サーバーにページを求める。これが下の層に運んでもらうデータになる。アプリケーションは HTTP のことだけを考え、データがどう運ばれるかは知らない。',
    },
  },
  {
    id: 'send-6-5',
    side: 'sender',
    layers: [6, 5],
    stack: DATA,
    changed: [],
    onWire: false,
    title: {
      en: 'Layers 6 and 5: handled by the application',
      ja: '第 6 層・第 5 層: アプリケーションが受け持つ',
    },
    description: {
      en: 'In the OSI model, the presentation layer decides how data is represented (here, the text is UTF-8) and the session layer manages the conversation. TCP/IP has no separate layers for these, so HTTP and the browser handle them, and no header is added.',
      ja: 'OSI 参照モデルでは、プレゼンテーション層がデータの表現（ここでは文字を UTF-8 にする）を、セッション層が対話の管理を受け持つ。TCP/IP にはこれらの層が独立していないので、HTTP とブラウザーが受け持ち、ヘッダーは付かない。',
    },
  },
  {
    id: 'send-4',
    side: 'sender',
    layers: [4],
    stack: SEGMENT,
    changed: ['tcp'],
    onWire: false,
    title: { en: 'Layer 4: TCP adds its header', ja: '第 4 層: TCP がヘッダーを付ける' },
    description: {
      en: 'TCP puts a header in front of the data: the source and destination ports (49152 → 80) that identify the applications, and the sequence and acknowledgment numbers for reliable delivery. Data plus TCP header is a segment.',
      ja: 'TCP はデータの前にヘッダーを付ける。アプリケーションを見分ける送信元と宛先のポート番号（49152 → 80）と、確実に届けるためのシーケンス番号と確認応答番号が入る。データに TCP のヘッダーが付いたものがセグメント。',
    },
  },
  {
    id: 'send-3',
    side: 'sender',
    layers: [3],
    stack: PACKET,
    changed: ['ip'],
    onWire: false,
    title: { en: 'Layer 3: IP adds its header', ja: '第 3 層: IP がヘッダーを付ける' },
    description: {
      en: 'IP puts its header in front of the segment: the source and destination IP addresses (192.168.1.10 → 192.0.2.10) that identify the hosts, the TTL, and the protocol number of what it carries (6 = TCP). Segment plus IP header is a packet.',
      ja: 'IP はセグメントの前にヘッダーを付ける。ホストを見分ける送信元と宛先の IP アドレス（192.168.1.10 → 192.0.2.10）、TTL、運んでいるもののプロトコル番号（6 = TCP）が入る。セグメントに IP のヘッダーが付いたものがパケット。',
    },
  },
  {
    id: 'send-2',
    side: 'sender',
    layers: [2],
    stack: FRAME,
    changed: ['eth', 'fcs'],
    onWire: false,
    title: {
      en: 'Layer 2: Ethernet adds a header and a trailer',
      ja: '第 2 層: Ethernet がヘッダーとトレーラーを付ける',
    },
    description: {
      en: 'Ethernet puts a header in front (the destination and source MAC addresses, and the type 0x0800 = IPv4) and an FCS (a CRC-32 checksum) after the packet. The destination MAC is the next device on the link: here, the router that leads out of the home network. Packet plus header and trailer is a frame.',
      ja: 'Ethernet はパケットの前にヘッダー（宛先と送信元の MAC アドレス、種類 0x0800 = IPv4）を、後ろに FCS（CRC-32 の検査値）を付ける。宛先の MAC アドレスは同じリンクの次の機器で、ここでは家庭のネットワークの出口のルーター。パケットにヘッダーとトレーラーが付いたものがフレーム。',
    },
  },
  {
    id: 'send-1',
    side: 'sender',
    layers: [1],
    stack: FRAME,
    changed: [],
    onWire: true,
    title: {
      en: 'Layer 1: the frame becomes signals',
      ja: '第 1 層: フレームが信号になる',
    },
    description: {
      en: 'The network card turns the bits of the frame into electrical signals on the cable (or radio waves for Wi-Fi). On the way, each router takes off the frame, looks at the IP header, and puts the packet in a new frame for the next link; this page skips those hops.',
      ja: 'ネットワークカードが、フレームのビットをケーブルの電気信号（Wi-Fi なら電波）にする。途中のルーターはそれぞれフレームを外して IP のヘッダーを見て、次のリンク用の新しいフレームに入れ直す。このページでは途中の経路は省略する。',
    },
  },
  {
    id: 'receive-1',
    side: 'receiver',
    layers: [1],
    stack: FRAME,
    changed: [],
    onWire: true,
    title: {
      en: 'Layer 1: the server receives the signals',
      ja: '第 1 層: サーバーが信号を受け取る',
    },
    description: {
      en: 'The web server’s network card turns the signals back into bits and hands the frame to the data link layer. From here, each layer removes its own header, in the reverse order.',
      ja: 'Web サーバーのネットワークカードが信号をビットに戻し、フレームをデータリンク層に渡す。ここからは、各層が自分のヘッダーを逆の順に外していく。',
    },
  },
  {
    id: 'receive-2',
    side: 'receiver',
    layers: [2],
    stack: PACKET,
    changed: ['eth', 'fcs'],
    onWire: false,
    title: {
      en: 'Layer 2: Ethernet checks and removes its header and trailer',
      ja: '第 2 層: Ethernet が確かめてヘッダーとトレーラーを外す',
    },
    description: {
      en: 'The data link layer checks that the destination MAC address is its own and recalculates the FCS to detect damage. A frame with a wrong FCS is discarded. Otherwise it removes the header and trailer and passes the packet up (the type 0x0800 says it is IPv4).',
      ja: 'データリンク層は、宛先の MAC アドレスが自分のものか確かめ、FCS を計算し直して壊れていないかを調べる。FCS が合わないフレームは捨てる。問題がなければヘッダーとトレーラーを外し、パケットを上に渡す（種類 0x0800 で IPv4 とわかる）。',
    },
  },
  {
    id: 'receive-3',
    side: 'receiver',
    layers: [3],
    stack: SEGMENT,
    changed: ['ip'],
    onWire: false,
    title: {
      en: 'Layer 3: IP checks and removes its header',
      ja: '第 3 層: IP が確かめてヘッダーを外す',
    },
    description: {
      en: 'The network layer checks that the destination IP address (192.0.2.10) is its own, removes the IP header, and passes the segment to TCP (protocol number 6).',
      ja: 'ネットワーク層は、宛先の IP アドレス（192.0.2.10）が自分のものか確かめ、IP のヘッダーを外して、セグメントを TCP に渡す（プロトコル番号 6）。',
    },
  },
  {
    id: 'receive-4',
    side: 'receiver',
    layers: [4],
    stack: DATA,
    changed: ['tcp'],
    onWire: false,
    title: {
      en: 'Layer 4: TCP checks and removes its header',
      ja: '第 4 層: TCP が確かめてヘッダーを外す',
    },
    description: {
      en: 'TCP uses the sequence number to put the data in order and acknowledges it. The destination port (80) tells it which application gets the data: the web server. It removes the TCP header and passes the data up.',
      ja: 'TCP はシーケンス番号でデータを順番どおりに並べ、確認応答する。宛先のポート番号（80）で、データを渡すアプリケーション（Web サーバー）がわかる。TCP のヘッダーを外して、データを上に渡す。',
    },
  },
  {
    id: 'receive-5-6',
    side: 'receiver',
    layers: [5, 6],
    stack: DATA,
    changed: [],
    onWire: false,
    title: {
      en: 'Layers 5 and 6: handled by the application',
      ja: '第 5 層・第 6 層: アプリケーションが受け持つ',
    },
    description: {
      en: 'As on the sending side, there is no separate header here. The web server software reads the text as UTF-8 and keeps track of the connection itself.',
      ja: '送信側と同じく、ここで外すヘッダーはない。Web サーバーのソフトウェアが自分で、文字を UTF-8 として読み、接続を管理する。',
    },
  },
  {
    id: 'receive-7',
    side: 'receiver',
    layers: [7],
    stack: DATA,
    changed: ['http'],
    onWire: false,
    title: {
      en: 'Layer 7: the web server reads the request',
      ja: '第 7 層: Web サーバーが要求を読む',
    },
    description: {
      en: 'The web server gets exactly the HTTP request the browser wrote: GET / HTTP/1.1. Each layer only talked to the same layer on the other side, using its own header. The response travels back the same way.',
      ja: 'Web サーバーは、ブラウザーが書いたとおりの HTTP の要求（GET / HTTP/1.1）を受け取る。各層は自分のヘッダーを使って、相手の同じ層とだけやり取りしていた。応答も同じ道のりで戻る。',
    },
  },
]

/** プレイヤー（StepControls・StepDescription）用のステップ（イベントは使わない） */
export const PLAYER_STEPS: readonly Step[] = OSI_STEPS.map((step) => ({
  id: step.id,
  title: step.title,
  description: step.description,
  events: [],
}))
