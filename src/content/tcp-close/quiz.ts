import type { Quiz } from '@/components/features/quiz/types'

/** TCP の接続の終了の理解度クイズ（根拠は scenario.ts の RFC 9293 の参照と同じ） */
export const tcpCloseQuiz: Quiz = {
  id: 'tcp-close',
  questions: [
    {
      id: 'fin-ack-number',
      prompt: {
        en: 'The client sends a FIN with Seq = 1001. What is the Ack number in the server’s ACK?',
        ja: 'クライアントが Seq = 1001 の FIN を送った。サーバーの ACK の Ack はいくつ？',
      },
      choices: [
        { id: '1001', text: { en: '1001', ja: '1001' } },
        { id: '1002', text: { en: '1002', ja: '1002' } },
        { id: '1000', text: { en: '1000', ja: '1000' } },
        { id: '0', text: { en: '0', ja: '0' } },
      ],
      answerId: '1002',
      explanation: {
        en: 'A FIN takes one sequence number, like a SYN. The server acknowledges it with Seq + 1 = 1002.',
        ja: 'FIN は SYN と同じようにシーケンス番号を 1 つ消費する。サーバーは Seq + 1 = 1002 で確認応答する。',
      },
    },
    {
      id: 'half-close',
      prompt: {
        en: 'The client has sent its FIN and received the ACK. What can the server still do?',
        ja: 'クライアントが FIN を送り、その ACK を受け取った。サーバーはまだ何ができる？',
      },
      choices: [
        {
          id: 'nothing',
          text: {
            en: 'Nothing: the connection is closed in both directions',
            ja: '何もできない（両方の向きが閉じている）',
          },
        },
        {
          id: 'receive',
          text: {
            en: 'Receive more data from the client',
            ja: 'クライアントからさらにデータを受け取る',
          },
        },
        {
          id: 'send',
          text: {
            en: 'Send more data to the client',
            ja: 'クライアントにさらにデータを送る',
          },
        },
      ],
      answerId: 'send',
      explanation: {
        en: 'Each direction is closed separately. The client’s direction is closed, but the server’s is still open (half-closed) until the server sends its own FIN.',
        ja: '向きごとに別々に閉じる。クライアントの向きは閉じたが、サーバーの向きはサーバーが自分の FIN を送るまで開いている（ハーフクローズ）。',
      },
    },
    {
      id: 'close-wait',
      prompt: {
        en: 'A server has many connections stuck in CLOSE-WAIT. What is the most likely cause?',
        ja: 'サーバーに CLOSE-WAIT のままの接続がたくさん残っている。最も考えられる原因は？',
      },
      choices: [
        {
          id: 'lost-ack',
          text: {
            en: 'The clients’ last ACKs were lost',
            ja: 'クライアントの最後の ACK が失われた',
          },
        },
        {
          id: 'app',
          text: {
            en: 'The server application does not close the connections',
            ja: 'サーバーのアプリケーションが接続を閉じていない',
          },
        },
        {
          id: 'time-wait',
          text: {
            en: 'The 2MSL timer is too long',
            ja: '2MSL のタイマーが長すぎる',
          },
        },
        {
          id: 'rst',
          text: {
            en: 'The clients aborted with RST',
            ja: 'クライアントが RST で中断した',
          },
        },
      ],
      answerId: 'app',
      explanation: {
        en: 'A side moves from CLOSE-WAIT to LAST-ACK only when its application closes the connection. The TCP stack cannot leave CLOSE-WAIT on its own.',
        ja: 'CLOSE-WAIT から LAST-ACK に移るのは、アプリケーションが接続を閉じたときだけ。TCP が自分から CLOSE-WAIT を抜けることはない。',
      },
    },
    {
      id: 'time-wait-who',
      prompt: {
        en: 'In a normal close, which side goes through TIME-WAIT?',
        ja: '通常のクローズで、TIME-WAIT を経るのはどちら？',
      },
      choices: [
        {
          id: 'active',
          text: {
            en: 'The side that closed first (sends the last ACK)',
            ja: '先に閉じた側（最後の ACK を送る側）',
          },
        },
        {
          id: 'passive',
          text: {
            en: 'The side that closed second (sends the second FIN)',
            ja: '後から閉じた側（2 つ目の FIN を送る側）',
          },
        },
        { id: 'both', text: { en: 'Both sides', ja: '両方' } },
      ],
      answerId: 'active',
      explanation: {
        en: 'The side that sends the last ACK waits in TIME-WAIT, so it can answer a retransmitted FIN if that ACK is lost. Both sides go through TIME-WAIT only in a simultaneous close.',
        ja: '最後の ACK を送った側が TIME-WAIT で待ち、その ACK が失われて FIN が再送されても答えられるようにする。両方が TIME-WAIT を経るのは同時クローズのときだけ。',
      },
    },
    {
      id: 'time-wait-length',
      prompt: {
        en: 'How long does RFC 9293 say TIME-WAIT lasts?',
        ja: 'RFC 9293 では、TIME-WAIT はどれだけ続く？',
      },
      choices: [
        {
          id: 'rto',
          text: { en: 'One retransmission timeout (RTO)', ja: '再送タイムアウト（RTO）1 回分' },
        },
        { id: '1msl', text: { en: '1MSL (2 minutes)', ja: '1MSL（2 分）' } },
        {
          id: 'none',
          text: { en: 'It ends as soon as the ACK is sent', ja: 'ACK を送ったらすぐ終わる' },
        },
        { id: '2msl', text: { en: '2MSL (4 minutes)', ja: '2MSL（4 分）' } },
      ],
      answerId: '2msl',
      explanation: {
        en: 'TIME-WAIT lasts twice the maximum segment lifetime. RFC 9293 sets MSL to 2 minutes, so 4 minutes; many implementations use a shorter time, such as 60 seconds on Linux.',
        ja: 'TIME-WAIT はセグメントの最大生存時間の 2 倍続く。RFC 9293 では MSL は 2 分なので 4 分。実装ではもっと短いことが多く、たとえば Linux は 60 秒。',
      },
    },
  ],
}
