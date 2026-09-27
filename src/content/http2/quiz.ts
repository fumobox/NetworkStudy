import type { Quiz } from '@/components/features/quiz/types'

/** HTTP/2 の理解度クイズ（根拠: RFC 9112 §9.3、RFC 9113 §5.1、§5.1.1、§6.1、RFC 7541 §2.3、RFC 9000 §1） */
export const http2Quiz: Quiz = {
  id: 'http2',
  questions: [
    {
      id: 'multiplex',
      prompt: {
        en: 'How can HTTP/2 deliver several responses at the same time on one connection?',
        ja: 'HTTP/2 は、どうやって 1 つの接続で複数の応答を同時に届ける？',
      },
      choices: [
        {
          id: 'connections',
          text: {
            en: 'It opens a separate TCP connection for each response',
            ja: '応答ごとに別の TCP の接続を開く',
          },
        },
        {
          id: 'frames',
          text: {
            en: 'It splits responses into frames tagged with a stream ID and interleaves them',
            ja: '応答をストリーム ID の付いたフレームに分け、混ぜて送る',
          },
        },
        {
          id: 'compress',
          text: {
            en: 'It compresses all responses into one file',
            ja: 'すべての応答を 1 つのファイルに圧縮する',
          },
        },
      ],
      answerId: 'frames',
      explanation: {
        en: 'Every frame carries the ID of its stream, so the receiver can put each response back together even when frames of different streams alternate on the wire.',
        ja: 'フレームにはどれもストリームの ID が付いているので、ストリームの違うフレームが交互に流れても、受け取る側は応答ごとに組み立て直せる。',
      },
    },
    {
      id: 'odd',
      prompt: {
        en: 'The browser opens streams 1, 3 and 5. Why are they odd numbers?',
        ja: 'ブラウザーはストリーム 1、3、5 を開いた。なぜ奇数なのか？',
      },
      choices: [
        {
          id: 'client',
          text: {
            en: 'Streams opened by the client use odd IDs; even IDs are for the server',
            ja: 'クライアントが開くストリームは奇数、偶数はサーバーが開く用',
          },
        },
        {
          id: 'lost',
          text: {
            en: 'Streams 2 and 4 were lost',
            ja: 'ストリーム 2 と 4 は失われた',
          },
        },
        {
          id: 'priority',
          text: {
            en: 'Odd numbers have higher priority',
            ja: '奇数のほうが優先度が高い',
          },
        },
      ],
      answerId: 'client',
      explanation: {
        en: 'So that both sides can open streams without choosing the same number, the client uses odd IDs and the server even ones. Stream 0 is for the connection itself, such as SETTINGS.',
        ja: '両者が同じ番号を選ばずにストリームを開けるよう、クライアントは奇数、サーバーは偶数を使う。ストリーム 0 は SETTINGS など接続そのもののためにある。',
      },
    },
    {
      id: 'hol',
      prompt: {
        en: 'In HTTP/2 over TCP, one packet carrying part of app.js is lost. Which streams have to wait?',
        ja: 'TCP の上の HTTP/2 で、app.js の一部を運ぶパケットが 1 つ失われた。待たされるのはどのストリーム？',
      },
      choices: [
        { id: 'one', text: { en: 'Only the stream of app.js', ja: 'app.js のストリームだけ' } },
        {
          id: 'all',
          text: {
            en: 'Every stream with data behind the lost packet',
            ja: '失われたパケットより後ろにデータがあるすべてのストリーム',
          },
        },
        {
          id: 'none',
          text: {
            en: 'None: HTTP/2 resends it at once',
            ja: 'どれも待たない。HTTP/2 がすぐ再送する',
          },
        },
      ],
      answerId: 'all',
      explanation: {
        en: 'TCP hands bytes to HTTP/2 strictly in order, so data of other streams that arrived after the gap waits in the receive buffer until the retransmission. This is TCP head-of-line blocking; QUIC keeps streams independent to avoid it.',
        ja: 'TCP はバイトを必ず順番どおりに HTTP/2 へ渡すので、抜けの後ろに届いたほかのストリームのデータも、再送まで受信バッファーで待つ。これが TCP のヘッドオブラインブロッキングで、QUIC はストリームを独立させてこれを避ける。',
      },
    },
    {
      id: 'hpack',
      prompt: {
        en: 'What does HPACK do?',
        ja: 'HPACK は何をする？',
      },
      choices: [
        {
          id: 'encrypt',
          text: { en: 'It encrypts the headers', ja: 'ヘッダーを暗号化する' },
        },
        {
          id: 'index',
          text: {
            en: 'It replaces repeated headers with numbers in a static and a dynamic table',
            ja: '繰り返し出てくるヘッダーを、静的テーブルと動的テーブルの番号に置き換える',
          },
        },
        {
          id: 'order',
          text: { en: 'It sorts requests by priority', ja: '要求を優先度の順に並べる' },
        },
      ],
      answerId: 'index',
      explanation: {
        en: 'Requests repeat almost the same headers. HPACK sends a common one such as :method GET as a static-table number, and remembers others in a dynamic table so later requests send only a number. Encryption is TLS’s job.',
        ja: '要求はほとんど同じヘッダーを繰り返す。HPACK は :method GET のようなよく使うものを静的テーブルの番号で送り、ほかは動的テーブルに覚えて、次からは番号だけを送る。暗号化は TLS の役目。',
      },
    },
  ],
}
