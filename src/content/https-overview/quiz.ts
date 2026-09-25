import type { Quiz } from '@/components/features/quiz/types'

/** HTTPS の全体像の理解度クイズ（根拠は各パートのシナリオの RFC の参照と同じ） */
export const httpsOverviewQuiz: Quiz = {
  id: 'https-overview',
  questions: [
    {
      id: 'order',
      prompt: {
        en: 'In what order do these happen when a browser opens https://www.example.com/ for the first time?',
        ja: 'ブラウザーが初めて https://www.example.com/ を開くとき、どの順に起きる？',
      },
      choices: [
        { id: 'tcp-dns-tls', text: { en: 'TCP → DNS → TLS → HTTP', ja: 'TCP → DNS → TLS → HTTP' } },
        { id: 'dns-tls-tcp', text: { en: 'DNS → TLS → TCP → HTTP', ja: 'DNS → TLS → TCP → HTTP' } },
        { id: 'dns-tcp-tls', text: { en: 'DNS → TCP → TLS → HTTP', ja: 'DNS → TCP → TLS → HTTP' } },
        { id: 'tls-dns-tcp', text: { en: 'TLS → DNS → TCP → HTTP', ja: 'TLS → DNS → TCP → HTTP' } },
      ],
      answerId: 'dns-tcp-tls',
      explanation: {
        en: 'The browser needs the server’s IP address before it can connect (DNS), a connection before it can run the TLS handshake over it (TCP), and the keys from TLS before it sends the request.',
        ja: '接続するにはサーバーの IP アドレスが要り（DNS）、その上で TLS のハンドシェイクをするには接続が要る（TCP）。要求は TLS で鍵を合わせてから送る。',
      },
    },
    {
      id: 'port',
      prompt: {
        en: 'Which port does the browser connect to for https://?',
        ja: 'https:// のとき、ブラウザーはどのポートに接続する？',
      },
      choices: [
        { id: '443', text: { en: '443', ja: '443' } },
        { id: '80', text: { en: '80', ja: '80' } },
        { id: '53', text: { en: '53', ja: '53' } },
      ],
      answerId: '443',
      explanation: {
        en: 'HTTPS uses TCP port 443 by default. Port 80 is for plain HTTP, and 53 is for DNS.',
        ja: 'HTTPS の既定のポートは TCP の 443 番。80 番は暗号化しない HTTP、53 番は DNS のポート。',
      },
    },
    {
      id: 'visible',
      prompt: {
        en: 'Someone watching the network between the browser and the server. What can they read?',
        ja: 'ブラウザーとサーバーの間のネットワークを見ている人がいる。読めるのはどれ？',
      },
      choices: [
        {
          id: 'path',
          text: { en: 'The path of the request (/)', ja: '要求のパス（/）' },
        },
        {
          id: 'html',
          text: { en: 'The HTML of the page', ja: 'ページの HTML' },
        },
        {
          id: 'name',
          text: {
            en: 'The name looked up in DNS (www.example.com)',
            ja: 'DNS で調べた名前（www.example.com）',
          },
        },
        {
          id: 'cert',
          text: { en: 'The server’s certificate', ja: 'サーバーの証明書' },
        },
      ],
      answerId: 'name',
      explanation: {
        en: 'In this walkthrough, the DNS lookup is not encrypted, so the name can be read. In TLS 1.3, the certificate, the request, and the page are all encrypted. (The name also appears in ClientHello as SNI, and encrypted DNS such as DNS over HTTPS can hide the lookup.)',
        ja: 'このステップ実行では名前解決は暗号化されないので、名前は読める。TLS 1.3 では証明書も要求もページも暗号化される（名前は ClientHello の SNI にも出る。DNS over HTTPS などの暗号化された DNS を使えば、名前解決は隠せる）。',
      },
    },
    {
      id: 'reuse',
      prompt: {
        en: 'After the page arrives, the browser fetches an image from the same server. What does it need to do again?',
        ja: 'ページが届いた後、ブラウザーは同じサーバーから画像を取得する。何をやり直す必要がある？',
      },
      choices: [
        {
          id: 'all',
          text: { en: 'DNS, TCP, and TLS again', ja: 'DNS、TCP、TLS をすべて' },
        },
        {
          id: 'tls',
          text: { en: 'Only the TLS handshake', ja: 'TLS のハンドシェイクだけ' },
        },
        {
          id: 'none',
          text: {
            en: 'None of them: it sends the request over the same connection',
            ja: 'どれもやり直さない（同じ接続で要求を送る）',
          },
        },
      ],
      answerId: 'none',
      explanation: {
        en: 'The connection and the TLS keys can be reused, so the browser sends the next request over the same connection. HTTP/2 can even carry several requests at once on one connection.',
        ja: '接続と TLS の鍵は使い回せるので、次の要求も同じ接続で送る。HTTP/2 なら、1 つの接続で複数の要求を同時に運べる。',
      },
    },
  ],
}
