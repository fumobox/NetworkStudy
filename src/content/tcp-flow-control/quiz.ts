import type { Quiz } from '@/components/features/quiz/types'

/** TCP のフロー制御の理解度クイズ（根拠は scenario.ts の RFC 9293 の参照と同じ） */
export const tcpFlowControlQuiz: Quiz = {
  id: 'tcp-flow-control',
  questions: [
    {
      id: 'usable-window',
      prompt: {
        en: 'SND.UNA = 3001, SND.NXT = 5001, and the last ACK advertised a window of 4000. How many more bytes can the sender send right now?',
        ja: 'SND.UNA = 3001、SND.NXT = 5001 で、最後の ACK のウィンドウは 4000。送信側は今、あと何バイト送れる？',
      },
      choices: [
        { id: '4000', text: { en: '4000', ja: '4000' } },
        { id: '2000', text: { en: '2000', ja: '2000' } },
        { id: '0', text: { en: '0', ja: '0' } },
        { id: '6000', text: { en: '6000', ja: '6000' } },
      ],
      answerId: '2000',
      explanation: {
        en: 'The window counts from the first unacknowledged byte, not from SND.NXT: 3001 + 4000 − 5001 = 2000. The 2000 bytes already in flight use up the rest.',
        ja: 'ウィンドウは SND.NXT からではなく、確認応答されていない最初のバイトから数える。3001 + 4000 − 5001 = 2000。残りは、すでに送って確認応答を待っている 2000 バイトが使っている。',
      },
    },
    {
      id: 'zero-window',
      prompt: {
        en: 'The receiver advertised a window of 0. What does the sender do?',
        ja: '受信側がウィンドウ 0 を知らせてきた。送信側はどうする？',
      },
      choices: [
        {
          id: 'close',
          text: { en: 'Close the connection', ja: '接続を閉じる' },
        },
        {
          id: 'wait',
          text: {
            en: 'Stop sending and wait for an ACK with a larger window',
            ja: '送るのをやめて、大きなウィンドウの ACK をただ待つ',
          },
        },
        {
          id: 'probe',
          text: {
            en: 'Stop sending data, but send a small probe from time to time',
            ja: 'データは送らないが、ときどき小さなプローブを送る',
          },
        },
      ],
      answerId: 'probe',
      explanation: {
        en: 'Pure ACKs (with no data) are never retransmitted, so if the ACK that reopens the window is lost, both sides would wait forever. The sender keeps sending window probes, with the interval doubling each time, and the reply to a probe tells it the current window.',
        ja: 'データのない ACK は再送されないので、ウィンドウを開く ACK が失われると、両方が永遠に待つことになる。送信側は間隔を倍にしながらウィンドウプローブを送り続け、その応答で今のウィンドウを知る。',
      },
    },
    {
      id: 'who-limits',
      prompt: {
        en: 'What does the receive window protect?',
        ja: '受信ウィンドウが守っているものは？',
      },
      choices: [
        {
          id: 'network',
          text: {
            en: 'The routers along the path',
            ja: '経路の途中のルーター',
          },
        },
        {
          id: 'receiver',
          text: {
            en: 'The receiver’s buffer',
            ja: '受信側のバッファー',
          },
        },
        {
          id: 'sender',
          text: {
            en: 'The sender’s buffer',
            ja: '送信側のバッファー',
          },
        },
      ],
      answerId: 'receiver',
      explanation: {
        en: 'Flow control keeps the sender from overrunning the receiver. Protecting the network is the job of congestion control (cwnd). The sender sends at most min(cwnd, receive window).',
        ja: 'フロー制御は、送信側が受信側をあふれさせないようにする。ネットワークを守るのは輻輳制御（cwnd）の役目。送信側が送るのは、最大で min(cwnd, 受信ウィンドウ)。',
      },
    },
    {
      id: 'sws',
      prompt: {
        en: 'The receiver’s buffer is full and the application reads only 500 bytes. Why might the receiver keep advertising a window of 0?',
        ja: '受信側のバッファーが満杯で、アプリケーションは 500 バイトだけ読んだ。受信側がウィンドウ 0 のままにしておくことがあるのはなぜ？',
      },
      choices: [
        {
          id: 'sws',
          text: {
            en: 'To avoid the sender filling the window with many tiny segments',
            ja: '送信側が小さなセグメントをたくさん送ってウィンドウを埋めるのを避けるため',
          },
        },
        {
          id: 'bug',
          text: {
            en: 'It is a bug: the window must always equal the free space',
            ja: '不具合。ウィンドウは常に空きと同じでなければならない',
          },
        },
        {
          id: 'congestion',
          text: {
            en: 'Because the network is congested',
            ja: 'ネットワークが混んでいるから',
          },
        },
      ],
      answerId: 'sws',
      explanation: {
        en: 'This is receiver-side silly window syndrome avoidance: the window is reopened only when at least min(half the buffer, one MSS) is free, so the sender can send full-sized segments.',
        ja: '受信側のシリーウィンドウシンドローム（SWS）回避。空きが min(バッファーの半分, 1 MSS) 以上になるまでウィンドウを開かないので、送信側は満杯のセグメントを送れる。',
      },
    },
  ],
}
