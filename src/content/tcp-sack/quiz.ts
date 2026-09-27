import type { Quiz } from '@/components/features/quiz/types'

/** 高速再送と SACK の理解度クイズ（根拠は scenario.ts の RFC 5681・RFC 2018・RFC 6675・RFC 6582 の参照と同じ） */
export const tcpSackQuiz: Quiz = {
  id: 'tcp-sack',
  questions: [
    {
      id: 'why-three',
      prompt: {
        en: 'Why does the sender wait for the third duplicate ACK, instead of retransmitting at the first one?',
        ja: '送信側が、1 つ目ではなく 3 つ目の重複 ACK まで待ってから再送するのはなぜ？',
      },
      choices: [
        {
          id: 'rto',
          text: {
            en: 'The RTO has not expired yet',
            ja: 'RTO がまだ満了していないから',
          },
        },
        {
          id: 'reorder',
          text: {
            en: 'One or two duplicates may just mean the segments were reordered',
            ja: '重複が 1 つや 2 つなら、セグメントの順序が入れ替わっただけかもしれないから',
          },
        },
        {
          id: 'window',
          text: {
            en: 'The receive window is full',
            ja: '受信ウィンドウがいっぱいだから',
          },
        },
      ],
      answerId: 'reorder',
      explanation: {
        en: 'A segment that arrives out of order also produces a duplicate ACK. Waiting for three duplicates (DupThresh = 3) makes it much more likely that the segment was really lost.',
        ja: '順序が入れ替わって届いたセグメントでも、重複 ACK が出る。重複を 3 つ（DupThresh = 3）待てば、本当に失われた可能性がずっと高くなる。',
      },
    },
    {
      id: 'sack-block',
      prompt: {
        en: 'The receiver has bytes 1001–2000 and 3001–5000 (MSS 1000). What does its ACK say?',
        ja: '受信側が 1001〜2000 と 3001〜5000 のバイトを受け取った（MSS 1000）。ACK の内容は？',
      },
      choices: [
        { id: 'b', text: { en: 'ACK 2001, SACK 3001-5000', ja: 'ACK 2001、SACK 3001-5000' } },
        { id: 'c', text: { en: 'ACK 5001', ja: 'ACK 5001' } },
        { id: 'a', text: { en: 'ACK 2001, SACK 3001-5001', ja: 'ACK 2001、SACK 3001-5001' } },
        { id: 'd', text: { en: 'ACK 2001, SACK 2001-3001', ja: 'ACK 2001、SACK 2001-3001' } },
      ],
      answerId: 'a',
      explanation: {
        en: 'The Ack is still the first missing byte, 2001. Each SACK block gives the first byte received and the first byte not received after it, so the block is 3001-5001.',
        ja: 'Ack は、まだ抜けている最初のバイトの 2001 のまま。SACK のブロックは、受け取った最初のバイトと、その後の受け取っていない最初のバイトで表すので、3001-5001 になる。',
      },
    },
    {
      id: 'two-holes',
      prompt: {
        en: 'Two segments from the same window are lost. Without SACK (NewReno), when does the sender learn about the second hole?',
        ja: '同じウィンドウのセグメントが 2 つ失われた。SACK がないと（NewReno）、送信側が 2 つ目の抜けを知るのはいつ？',
      },
      choices: [
        {
          id: 'partial',
          text: {
            en: 'When the ACK for the first retransmission stops at the second hole (a partial ACK)',
            ja: '1 つ目の再送への ACK が、2 つ目の抜けで止まったとき（部分的な確認応答）',
          },
        },
        {
          id: 'dupacks',
          text: {
            en: 'At the third duplicate ACK, together with the first hole',
            ja: '3 つ目の重複 ACK で、1 つ目の抜けと同時に',
          },
        },
        {
          id: 'never',
          text: {
            en: 'Only after the RTO expires',
            ja: 'RTO が満了した後だけ',
          },
        },
      ],
      answerId: 'partial',
      explanation: {
        en: 'A cumulative ACK only points at the first missing byte. The sender sees the second hole only when the retransmission fills the first one and the Ack stops short of everything sent: one more round trip. With SACK, the blocks show both holes at once.',
        ja: '累積の確認応答は、抜けている最初のバイトしか示さない。再送で 1 つ目の抜けが埋まり、Ack が送ったものの最後まで進まなかったときに初めて、2 つ目の抜けがわかる。1 往復よけいにかかる。SACK があれば、ブロックから 2 つの抜けが同時にわかる。',
      },
    },
    {
      id: 'tail',
      prompt: {
        en: 'Only the last segment of a burst is lost. Why doesn’t fast retransmit help?',
        ja: 'まとめて送ったうち、最後のセグメントだけが失われた。高速再送が役に立たないのはなぜ？',
      },
      choices: [
        {
          id: 'sack-off',
          text: {
            en: 'SACK is turned off for the last segment',
            ja: '最後のセグメントでは SACK が使えないから',
          },
        },
        {
          id: 'no-dupacks',
          text: {
            en: 'No later segment arrives, so there are no duplicate ACKs',
            ja: 'その後に届くセグメントがないので、重複 ACK が出ないから',
          },
        },
        {
          id: 'window-zero',
          text: {
            en: 'The receive window becomes zero',
            ja: '受信ウィンドウが 0 になるから',
          },
        },
      ],
      answerId: 'no-dupacks',
      explanation: {
        en: 'Duplicate ACKs are caused by segments arriving after a hole. With nothing after the lost segment, the sender must wait for the RTO. Tail loss probes (RACK-TLP, RFC 8985) shorten that wait.',
        ja: '重複 ACK は、抜けの後に届いたセグメントから出る。失われたセグメントの後に何もなければ、送信側は RTO を待つしかない。テールロスプローブ（RACK-TLP、RFC 8985）がこの待ちを短くする。',
      },
    },
  ],
}
