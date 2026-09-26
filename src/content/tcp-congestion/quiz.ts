import type { Quiz } from '@/components/features/quiz/types'

/** TCP の輻輳制御の理解度クイズ（根拠: RFC 5681 §3.1、§3.2） */
export const tcpCongestionQuiz: Quiz = {
  id: 'tcp-congestion',
  questions: [
    {
      id: 'slow-start',
      prompt: {
        en: 'In slow start, cwnd is 4 segments and all 4 are acknowledged. What is cwnd after that round trip?',
        ja: 'スロースタートで cwnd が 4 セグメントのとき、4 つとも確認応答された。その往復の後の cwnd は？',
      },
      choices: [
        { id: '5', text: { en: '5', ja: '5' } },
        { id: '8', text: { en: '8', ja: '8' } },
        { id: '16', text: { en: '16', ja: '16' } },
        { id: '4', text: { en: '4', ja: '4' } },
      ],
      answerId: '8',
      explanation: {
        en: 'In slow start, each ACK increases cwnd by one segment. Four ACKs add four, so cwnd doubles from 4 to 8 (as long as ssthresh is not reached).',
        ja: 'スロースタートでは、ACK 1 つごとに cwnd が 1 セグメント増える。4 つの ACK で 4 増えるので、cwnd は 4 から 8 に倍になる（ssthresh に達しない限り）。',
      },
    },
    {
      id: 'avoidance',
      prompt: {
        en: 'How does cwnd grow in congestion avoidance?',
        ja: '輻輳回避では、cwnd はどう増える？',
      },
      choices: [
        {
          id: 'double',
          text: { en: 'It doubles every round trip', ja: '1 往復ごとに倍になる' },
        },
        {
          id: 'plus-one',
          text: {
            en: 'By about one segment per round trip',
            ja: '1 往復あたり約 1 セグメント増える',
          },
        },
        { id: 'fixed', text: { en: 'It stays the same', ja: '変わらない' } },
      ],
      answerId: 'plus-one',
      explanation: {
        en: 'Once cwnd reaches ssthresh, the sender probes carefully: cwnd grows by about one segment per round trip (additive increase).',
        ja: 'cwnd が ssthresh に達すると、送信側は慎重に帯域を探る。cwnd は 1 往復あたり約 1 セグメントずつ増える（加算的増加）。',
      },
    },
    {
      id: 'dupack',
      prompt: {
        en: 'What does the sender do when three duplicate ACKs arrive?',
        ja: '重複 ACK が 3 つ届いたとき、送信側はどうする？',
      },
      choices: [
        {
          id: 'wait',
          text: {
            en: 'Waits for the retransmission timer to expire',
            ja: '再送タイマーの満了を待つ',
          },
        },
        {
          id: 'reset',
          text: {
            en: 'Drops cwnd to 1 and starts slow start again',
            ja: 'cwnd を 1 に下げて、スロースタートからやり直す',
          },
        },
        {
          id: 'fast',
          text: {
            en: 'Retransmits the missing segment at once and halves ssthresh',
            ja: '失われたセグメントをすぐに再送し、ssthresh を半分にする',
          },
        },
      ],
      answerId: 'fast',
      explanation: {
        en: 'Three duplicate ACKs mean later segments still arrive, so the sender retransmits right away (fast retransmit), sets ssthresh to half of the data in flight, and continues without going back to slow start (fast recovery).',
        ja: '重複 ACK が 3 つ届くのは、後のセグメントは届いているということ。送信側はすぐに再送し（高速再送）、ssthresh を送信中のデータの半分にして、スロースタートに戻らずに続ける（高速リカバリ）。',
      },
    },
    {
      id: 'rto',
      prompt: {
        en: 'After an RTO expires, what does the sender set cwnd to?',
        ja: 'RTO が満了した後、送信側は cwnd をいくつにする？',
      },
      choices: [
        { id: 'half', text: { en: 'Half of the previous cwnd', ja: '前の cwnd の半分' } },
        { id: 'ssthresh', text: { en: 'The same as ssthresh', ja: 'ssthresh と同じ' } },
        { id: 'unchanged', text: { en: 'It keeps the same value', ja: '変えない' } },
        { id: 'one', text: { en: '1 segment', ja: '1 セグメント' } },
      ],
      answerId: 'one',
      explanation: {
        en: 'A timeout suggests heavy congestion, so cwnd drops to one segment (the loss window) and slow start begins again. ssthresh is set to half of the data in flight.',
        ja: 'タイムアウトは激しい輻輳のしるしなので、cwnd は 1 セグメント（ロスウィンドウ）に下がり、スロースタートからやり直す。ssthresh は送信中のデータの半分にする。',
      },
    },
  ],
}
