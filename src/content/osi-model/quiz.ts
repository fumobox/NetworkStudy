import type { Quiz } from '@/components/features/quiz/types'

/**
 * OSI 参照モデルの理解度クイズ（根拠: ISO/IEC 7498-1、RFC 1122 §1.1.3）。
 * RFC 1122 はアプリケーション層を OSI の第 6・7 層に対応させ、第 5 層は慣例で含める（layers.ts を参照）
 */
export const osiModelQuiz: Quiz = {
  id: 'osi-model',
  questions: [
    {
      id: 'ip-layer',
      prompt: {
        en: 'Which OSI layer does IP belong to?',
        ja: 'IP は OSI 参照モデルのどの層に当たる？',
      },
      choices: [
        { id: '2', text: { en: 'Layer 2 (data link)', ja: '第 2 層（データリンク層）' } },
        { id: '4', text: { en: 'Layer 4 (transport)', ja: '第 4 層（トランスポート層）' } },
        { id: '3', text: { en: 'Layer 3 (network)', ja: '第 3 層（ネットワーク層）' } },
        { id: '7', text: { en: 'Layer 7 (application)', ja: '第 7 層（アプリケーション層）' } },
      ],
      answerId: '3',
      explanation: {
        en: 'IP delivers packets between hosts across networks, which is the job of the network layer (layer 3).',
        ja: 'IP はネットワークをまたいでホストどうしにパケットを届ける。これはネットワーク層（第 3 層）の役目。',
      },
    },
    {
      id: 'segment',
      prompt: {
        en: 'What is data plus a TCP header called?',
        ja: 'データに TCP のヘッダーが付いたものを何という？',
      },
      choices: [
        { id: 'segment', text: { en: 'Segment', ja: 'セグメント' } },
        { id: 'frame', text: { en: 'Frame', ja: 'フレーム' } },
        { id: 'packet', text: { en: 'Packet', ja: 'パケット' } },
      ],
      answerId: 'segment',
      explanation: {
        en: 'At the transport layer, the unit is a segment. IP turns it into a packet, and Ethernet into a frame.',
        ja: 'トランスポート層の単位はセグメント。IP がパケットにし、Ethernet がフレームにする。',
      },
    },
    {
      id: 'order',
      prompt: {
        en: 'In an Ethernet frame carrying a web request, which header comes first?',
        ja: 'Web の要求を運ぶ Ethernet のフレームで、いちばん前にあるヘッダーはどれ？',
      },
      choices: [
        { id: 'tcp', text: { en: 'TCP header', ja: 'TCP のヘッダー' } },
        { id: 'http', text: { en: 'HTTP data', ja: 'HTTP のデータ' } },
        { id: 'ip', text: { en: 'IP header', ja: 'IP のヘッダー' } },
        { id: 'eth', text: { en: 'Ethernet header', ja: 'Ethernet のヘッダー' } },
      ],
      answerId: 'eth',
      explanation: {
        en: 'Each lower layer adds its header in front of what it gets from above, so the lowest layer’s header is outermost: Ethernet, IP, TCP, then the data (and the FCS at the end).',
        ja: '下の層ほど、上から受け取ったものの前にヘッダーを付けるので、いちばん下の層のヘッダーが外側になる。Ethernet、IP、TCP、データの順（最後に FCS）。',
      },
    },
    {
      id: 'tcpip',
      prompt: {
        en: 'Which OSI layers does the application layer of the TCP/IP model cover?',
        ja: 'TCP/IP モデルのアプリケーション層は、OSI のどの層に当たる？',
      },
      choices: [
        { id: '7', text: { en: 'Layer 7 only', ja: '第 7 層だけ' } },
        { id: '5-7', text: { en: 'Layers 5 to 7', ja: '第 5〜7 層' } },
        { id: '4-7', text: { en: 'Layers 4 to 7', ja: '第 4〜7 層' } },
      ],
      answerId: '5-7',
      explanation: {
        en: 'TCP/IP has no separate session and presentation layers. The application (for example HTTP) handles them, so its application layer covers OSI layers 5 to 7.',
        ja: 'TCP/IP にはセッション層とプレゼンテーション層が独立していない。アプリケーション（HTTP など）が受け持つので、アプリケーション層は OSI の第 5〜7 層に当たる。',
      },
    },
    {
      id: 'mac',
      prompt: {
        en: 'The PC sends a frame to a server on another network. Whose MAC address is the destination of the frame?',
        ja: 'PC が別のネットワークのサーバーにフレームを送る。フレームの宛先の MAC アドレスは誰のもの？',
      },
      choices: [
        { id: 'server', text: { en: 'The server’s', ja: 'サーバーのもの' } },
        { id: 'broadcast', text: { en: 'The broadcast address', ja: 'ブロードキャストアドレス' } },
        {
          id: 'router',
          text: {
            en: 'The router’s (the next device on the link)',
            ja: 'ルーターのもの（同じリンクの次の機器）',
          },
        },
      ],
      answerId: 'router',
      explanation: {
        en: 'The data link layer only delivers to the next device on the same link. The IP header keeps the server’s address, but the frame goes to the router, which forwards the packet in a new frame.',
        ja: 'データリンク層が届けるのは、同じリンクの次の機器まで。IP のヘッダーにはサーバーのアドレスが入ったままだが、フレームはルーターに届き、ルーターが新しいフレームでパケットを転送する。',
      },
    },
  ],
}
