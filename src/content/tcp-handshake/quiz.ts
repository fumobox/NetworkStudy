import type { Quiz } from '@/components/features/quiz/types'

/** TCP 3 ウェイハンドシェイクの理解度クイズ（根拠は scenario.ts の RFC 参照と同じ） */
export const tcpHandshakeQuiz: Quiz = {
  id: 'tcp-handshake',
  questions: [
    {
      id: 'first-segment',
      prompt: {
        en: 'Which segment does the client send first to open a connection?',
        ja: '接続を開くとき、クライアントが最初に送るセグメントはどれ？',
      },
      choices: [
        { id: 'syn', text: { en: 'SYN', ja: 'SYN' } },
        { id: 'syn-ack', text: { en: 'SYN, ACK', ja: 'SYN, ACK' } },
        { id: 'ack', text: { en: 'ACK', ja: 'ACK' } },
        { id: 'fin', text: { en: 'FIN', ja: 'FIN' } },
      ],
      answerId: 'syn',
      explanation: {
        en: 'The client starts with a SYN that carries its initial sequence number. The server answers with a SYN, ACK, and the client finishes with an ACK.',
        ja: 'クライアントは自分の初期シーケンス番号を載せた SYN から始める。サーバーが SYN, ACK で応え、クライアントが ACK で締めくくる。',
      },
    },
    {
      id: 'syn-ack-ack-number',
      prompt: {
        en: 'The client’s SYN has Seq = 1000. What is the Ack number in the server’s SYN, ACK?',
        ja: 'クライアントの SYN の Seq が 1000 のとき、サーバーの SYN, ACK の Ack はいくつ？',
      },
      choices: [
        { id: '1000', text: { en: '1000', ja: '1000' } },
        { id: '1001', text: { en: '1001', ja: '1001' } },
        { id: '5000', text: { en: '5000 (the server’s ISS)', ja: '5000（サーバーの ISS）' } },
        { id: '0', text: { en: '0', ja: '0' } },
      ],
      answerId: '1001',
      explanation: {
        en: 'The Ack number is the next sequence number the server expects. The SYN uses one sequence number, so it is 1000 + 1 = 1001.',
        ja: 'Ack はサーバーが次に期待するシーケンス番号。SYN がシーケンス番号を 1 つ消費するので、1000 + 1 = 1001 になる。',
      },
    },
    {
      id: 'state-after-syn',
      prompt: {
        en: 'Which state is the client in right after sending the SYN?',
        ja: 'SYN を送った直後、クライアントはどの状態にある？',
      },
      choices: [
        { id: 'listen', text: { en: 'LISTEN', ja: 'LISTEN' } },
        { id: 'syn-sent', text: { en: 'SYN-SENT', ja: 'SYN-SENT' } },
        { id: 'syn-received', text: { en: 'SYN-RECEIVED', ja: 'SYN-RECEIVED' } },
        { id: 'established', text: { en: 'ESTABLISHED', ja: 'ESTABLISHED' } },
      ],
      answerId: 'syn-sent',
      explanation: {
        en: 'The client waits in SYN-SENT for the SYN, ACK. LISTEN and SYN-RECEIVED are server-side states in this exchange.',
        ja: 'クライアントは SYN-SENT で SYN, ACK を待つ。このやり取りでは、LISTEN と SYN-RECEIVED はサーバー側の状態。',
      },
    },
    {
      id: 'syn-lost',
      prompt: {
        en: 'The client’s SYN is lost on the way. What happens next?',
        ja: 'クライアントの SYN が途中で失われた。次に何が起きる？',
      },
      choices: [
        {
          id: 'retransmit',
          text: {
            en: 'The client resends the SYN when its retransmission timer expires (1 s at first, then doubling)',
            ja: 'クライアントの再送タイマーが満了すると SYN を再送する（最初は 1 秒、その後は倍に延びる）',
          },
        },
        {
          id: 'rst',
          text: { en: 'The server sends a RST', ja: 'サーバーが RST を送る' },
        },
        {
          id: 'established',
          text: {
            en: 'The connection is established anyway',
            ja: 'それでも接続は確立する',
          },
        },
        {
          id: 'server-retransmit',
          text: {
            en: 'The server asks the client to resend',
            ja: 'サーバーがクライアントに再送を求める',
          },
        },
      ],
      answerId: 'retransmit',
      explanation: {
        en: 'The server never saw the SYN, so it cannot react. The client’s retransmission timer (initial RTO 1 s) expires and it resends the same SYN; each further timeout doubles the RTO.',
        ja: 'サーバーは SYN を受け取っていないので反応できない。クライアントの再送タイマー（初期 RTO 1 秒）が満了して同じ SYN を再送し、さらにタイムアウトするたびに RTO は倍になる。',
      },
    },
    {
      id: 'closed-port',
      prompt: {
        en: 'A SYN arrives at a port where no application is listening. How does the server respond?',
        ja: 'どのアプリケーションも待ち受けていないポートに SYN が届いた。サーバーはどう応える？',
      },
      choices: [
        { id: 'rst-ack', text: { en: 'With RST, ACK', ja: 'RST, ACK を返す' } },
        { id: 'syn-ack', text: { en: 'With SYN, ACK', ja: 'SYN, ACK を返す' } },
        { id: 'fin', text: { en: 'With FIN', ja: 'FIN を返す' } },
        { id: 'silence', text: { en: 'It never responds', ja: '何も返さない' } },
      ],
      answerId: 'rst-ack',
      explanation: {
        en: 'TCP answers a SYN for a closed port with RST, ACK (Seq 0, Ack = the SYN’s Seq + 1). The client gives up, and the application sees “Connection refused”. (A firewall may drop the SYN silently instead, but that is not TCP itself.)',
        ja: 'TCP は閉じたポートへの SYN に RST, ACK（Seq 0、Ack = SYN の Seq + 1）で応える。クライアントは接続をあきらめ、アプリケーションには「Connection refused」が伝わる。（ファイアウォールが SYN を黙って捨てることもあるが、それは TCP 自体の動作ではない。）',
      },
    },
  ],
}
