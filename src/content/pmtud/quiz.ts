import type { Quiz } from '@/components/features/quiz/types'

/** パス MTU 探索の理解度クイズ（根拠は scenario.ts の RFC 1191・RFC 791・RFC 1812 の参照と同じ） */
export const pmtudQuiz: Quiz = {
  id: 'pmtud',
  questions: [
    {
      id: 'new-mss',
      prompt: {
        en: 'The ICMP Fragmentation Needed says Next-Hop MTU = 1492. With no IP or TCP options, how many bytes of data fit in one TCP segment now?',
        ja: 'ICMP の Fragmentation Needed に、Next-Hop MTU = 1492 とあった。IP と TCP のオプションがないとき、1 つのセグメントで送れるデータは何バイト？',
      },
      choices: [
        { id: '1492', text: { en: '1492', ja: '1492' } },
        { id: '1472', text: { en: '1472', ja: '1472' } },
        { id: '1452', text: { en: '1452', ja: '1452' } },
        { id: '1460', text: { en: '1460', ja: '1460' } },
      ],
      answerId: '1452',
      explanation: {
        en: 'The MTU counts the whole IP packet, so the 20-byte IP header and the 20-byte TCP header come out of it: 1492 − 40 = 1452.',
        ja: 'MTU は IP のパケット全体の大きさなので、IP のヘッダー 20 バイトと TCP のヘッダー 20 バイトを引く。1492 − 40 = 1452。',
      },
    },
    {
      id: 'black-hole',
      prompt: {
        en: 'A web page starts loading and then hangs. Small requests work, but large responses never arrive. What is a likely cause?',
        ja: 'Web のページが読み込み始めたまま止まる。小さな要求は通るが、大きな応答が届かない。考えられる原因は？',
      },
      choices: [
        {
          id: 'dns',
          text: { en: 'The DNS name cannot be resolved', ja: 'DNS の名前が解決できない' },
        },
        {
          id: 'icmp',
          text: {
            en: 'A firewall drops ICMP, so the Fragmentation Needed messages never arrive',
            ja: 'ファイアウォールが ICMP を捨てていて、Fragmentation Needed が届かない',
          },
        },
        {
          id: 'handshake',
          text: {
            en: 'The TCP three-way handshake failed',
            ja: 'TCP の 3 ウェイハンドシェイクが失敗した',
          },
        },
      ],
      answerId: 'icmp',
      explanation: {
        en: 'The name was resolved and the handshake succeeded, or nothing would load at all. Full-sized packets with DF are dropped, and without the ICMP the sender never learns to make them smaller: a path MTU black hole.',
        ja: '名前の解決やハンドシェイクが失敗していたら、何も読み込めないはず。DF の立った満杯の大きさのパケットが捨てられ、ICMP が届かないので送信側は小さくすることを知らない。パス MTU のブラックホール。',
      },
    },
    {
      id: 'offset',
      prompt: {
        en: 'A router splits a packet. The first fragment carries 1472 bytes of data. What is the Fragment offset field in the second fragment?',
        ja: 'ルーターがパケットを分割した。1 つ目のフラグメントは 1472 バイトのデータを運ぶ。2 つ目のフラグメントの Fragment offset のフィールドの値は？',
      },
      choices: [
        { id: '1472', text: { en: '1472', ja: '1472' } },
        { id: '184', text: { en: '184', ja: '184' } },
        { id: '1473', text: { en: '1473', ja: '1473' } },
        { id: '1', text: { en: '1', ja: '1' } },
      ],
      answerId: '184',
      explanation: {
        en: 'The offset is counted in units of 8 bytes: 1472 / 8 = 184. That is also why every fragment except the last must carry a multiple of 8 bytes of data.',
        ja: 'オフセットは 8 バイト単位で数える。1472 ÷ 8 = 184。最後のフラグメント以外が 8 の倍数のバイト数のデータを運ぶのはこのため。',
      },
    },
    {
      id: 'reassembly',
      prompt: {
        en: 'Who puts the fragments back together?',
        ja: 'フラグメントを組み立て直すのは誰？',
      },
      choices: [
        {
          id: 'next-router',
          text: { en: 'The next router on the path', ja: '経路の次のルーター' },
        },
        {
          id: 'splitting-router',
          text: {
            en: 'The router that split the packet, when the reply comes back',
            ja: '分割したルーター（応答が戻ってきたとき）',
          },
        },
        {
          id: 'destination',
          text: { en: 'Only the destination host', ja: '宛先のホストだけ' },
        },
      ],
      answerId: 'destination',
      explanation: {
        en: 'Routers forward fragments like any other packets and never reassemble them. The destination collects the fragments with the same Identification and rebuilds the original packet. If any fragment is lost, the whole packet is lost.',
        ja: 'ルーターはフラグメントもほかのパケットと同じように転送し、組み立て直さない。宛先が同じ Identification のフラグメントを集めて、元のパケットに戻す。フラグメントが 1 つでも失われると、パケット全体が失われる。',
      },
    },
  ],
}
