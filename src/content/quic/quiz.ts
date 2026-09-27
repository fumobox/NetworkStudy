import type { Quiz } from '@/components/features/quiz/types'

/** QUIC の理解度クイズ（根拠: RFC 9000 §7、§12.3、§13.3、RFC 9001 §5.2、§9.2、RFC 9002 §4.2、RFC 9114 §1） */
export const quicQuiz: Quiz = {
  id: 'quic',
  questions: [
    {
      id: 'one-rtt',
      prompt: {
        en: 'Why can a QUIC connection send its first request after only one round trip?',
        ja: 'QUIC の接続は、なぜ 1 往復で最初の要求を送れる？',
      },
      choices: [
        {
          id: 'combined',
          text: {
            en: 'The transport handshake and the TLS 1.3 handshake are done together',
            ja: 'トランスポートのハンドシェイクと TLS 1.3 のハンドシェイクを一緒に行う',
          },
        },
        {
          id: 'no-tls',
          text: { en: 'QUIC does not use encryption', ja: 'QUIC は暗号化を使わない' },
        },
        {
          id: 'faster',
          text: {
            en: 'UDP packets travel faster than TCP packets',
            ja: 'UDP のパケットは TCP より速く届く',
          },
        },
      ],
      answerId: 'combined',
      explanation: {
        en: 'Over TCP, the TCP handshake takes one round trip and TLS 1.3 another. QUIC carries the TLS messages in its own first packets, so after one round trip both the connection and the keys are ready. UDP itself is not faster.',
        ja: 'TCP では、TCP のハンドシェイクに 1 往復、TLS 1.3 にもう 1 往復かかる。QUIC は最初のパケットで TLS のメッセージを運ぶので、1 往復で接続も鍵もそろう。UDP そのものが速いわけではない。',
      },
    },
    {
      id: 'zero-rtt',
      prompt: {
        en: 'Which requests are suitable for 0-RTT data?',
        ja: '0-RTT のデータに向いている要求は？',
      },
      choices: [
        {
          id: 'payment',
          text: { en: 'A POST that makes a payment', ja: '支払いをする POST' },
        },
        {
          id: 'get',
          text: {
            en: 'A GET that is safe to repeat, such as loading a page',
            ja: 'ページの読み込みのような、繰り返しても問題のない GET',
          },
        },
        {
          id: 'any',
          text: {
            en: 'Any request: 0-RTT is as safe as 1-RTT',
            ja: 'どれでもよい。0-RTT は 1-RTT と同じく安全',
          },
        },
      ],
      answerId: 'get',
      explanation: {
        en: 'An attacker can record 0-RTT data and send it to the server again (a replay). So 0-RTT should carry only requests that do no harm if they are processed twice, such as a GET.',
        ja: '攻撃者は 0-RTT のデータを記録して、サーバーにもう一度送れる（リプレイ攻撃）。そのため 0-RTT には、GET のように 2 回処理されても害のない要求だけを載せる。',
      },
    },
    {
      id: 'streams',
      prompt: {
        en: 'In HTTP/3 over QUIC, a packet with data of stream 0 is lost. What happens to stream 4?',
        ja: 'QUIC の上の HTTP/3 で、ストリーム 0 のデータを運ぶパケットが失われた。ストリーム 4 はどうなる？',
      },
      choices: [
        {
          id: 'waits',
          text: {
            en: 'It waits until the lost data of stream 0 is resent',
            ja: 'ストリーム 0 の失われたデータが再送されるまで待つ',
          },
        },
        {
          id: 'goes',
          text: {
            en: 'It keeps going: only stream 0 waits for the retransmission',
            ja: 'そのまま進む。再送を待つのはストリーム 0 だけ',
          },
        },
        {
          id: 'closed',
          text: {
            en: 'The whole connection is closed and opened again',
            ja: '接続全体を閉じて、開き直す',
          },
        },
      ],
      answerId: 'goes',
      explanation: {
        en: 'QUIC delivers each stream separately, so a gap in stream 0 does not hold back stream 4. Over TCP (HTTP/2), all streams would wait, because TCP delivers bytes strictly in order.',
        ja: 'QUIC はストリームごとに別々に渡すので、ストリーム 0 の抜けはストリーム 4 を止めない。TCP の上（HTTP/2）なら、TCP がバイトを必ず順番どおりに渡すので、すべてのストリームが待つ。',
      },
    },
    {
      id: 'packet-number',
      prompt: {
        en: 'QUIC resends the data of lost packet 1. What is the packet number of the retransmission?',
        ja: 'QUIC が、失われたパケット 1 のデータを送り直す。再送のパケット番号は？',
      },
      choices: [
        { id: 'same', text: { en: 'Packet 1 again', ja: 'もう一度 1' } },
        {
          id: 'new',
          text: {
            en: 'A new, higher number; packet numbers are never reused',
            ja: '新しい、より大きな番号。パケット番号は使い回さない',
          },
        },
        { id: 'zero', text: { en: 'Packet 0', ja: '0' } },
      ],
      answerId: 'new',
      explanation: {
        en: 'QUIC retransmits information, not packets: the lost STREAM data goes into a new packet with a new number. This way an acknowledgment always tells exactly which packet arrived, unlike TCP’s ambiguous retransmissions.',
        ja: 'QUIC が送り直すのはパケットではなく情報。失われた STREAM のデータは、新しい番号の新しいパケットに入れる。こうすると確認応答が、どのパケットが届いたかを必ず正確に示す。TCP の再送のように、元と再送のどちらが届いたかわからなくなることがない。',
      },
    },
  ],
}
