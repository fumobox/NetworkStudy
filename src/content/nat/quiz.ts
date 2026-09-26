import type { Quiz } from '@/components/features/quiz/types'

/** NAT の理解度クイズ（根拠: RFC 1918、RFC 3022、RFC 4787、RFC 5382） */
export const natQuiz: Quiz = {
  id: 'nat',
  questions: [
    {
      id: 'why',
      prompt: {
        en: 'Why can’t the PC use 192.168.1.10 as the source address on the Internet?',
        ja: 'PC がインターネットで 192.168.1.10 を送信元に使えないのはなぜ？',
      },
      choices: [
        {
          id: 'secret',
          text: {
            en: 'Because it would reveal the PC’s location',
            ja: 'PC の場所がわかってしまうから',
          },
        },
        {
          id: 'private',
          text: {
            en: 'It is a private address, so replies to it cannot be routed back',
            ja: 'プライベートアドレスなので、それ宛ての返事が戻る経路がないから',
          },
        },
        {
          id: 'length',
          text: { en: 'Because it is too long for IPv4', ja: 'IPv4 には長すぎるから' },
        },
      ],
      answerId: 'private',
      explanation: {
        en: 'Addresses in 192.168.0.0/16 are used by many private networks at the same time and are not routed on the Internet. The router replaces them with its public address.',
        ja: '192.168.0.0/16 のアドレスはたくさんのプライベートネットワークが同時に使っていて、インターネットでは経路がない。ルーターが自分のグローバルアドレスに置き換える。',
      },
    },
    {
      id: 'same-port',
      prompt: {
        en: 'Two PCs connect to the same server from the same source port 49152. How does the router tell the replies apart?',
        ja: '2 台の PC が、同じ送信元ポート 49152 から同じサーバーに接続した。ルーターは返事をどう見分ける？',
      },
      choices: [
        {
          id: 'mac',
          text: {
            en: 'By the PCs’ MAC addresses in the reply',
            ja: '返事に入っている PC の MAC アドレスで',
          },
        },
        {
          id: 'order',
          text: { en: 'By the order the replies arrive in', ja: '返事が届く順番で' },
        },
        {
          id: 'port',
          text: {
            en: 'It gives each connection a different external port',
            ja: '接続ごとに違う外側のポートを割り当てる',
          },
        },
        {
          id: 'cannot',
          text: { en: 'It cannot; one of them fails', ja: '見分けられないので、片方は失敗する' },
        },
      ],
      answerId: 'port',
      explanation: {
        en: 'NAPT translates the port as well as the address. The replies come back to 203.0.113.5:40001 and 203.0.113.5:40002, and the NAT table says which PC each belongs to.',
        ja: 'NAPT はアドレスだけでなくポートも変換する。返事は 203.0.113.5:40001 と 203.0.113.5:40002 に戻り、NAT の変換表でどちらの PC のものかがわかる。',
      },
    },
    {
      id: 'server-view',
      prompt: {
        en: 'Which address and port does the server see for the PC’s connection?',
        ja: 'サーバーから見た、PC の接続の相手のアドレスとポートはどれ？',
      },
      choices: [
        { id: 'public', text: { en: '203.0.113.5:40001', ja: '203.0.113.5:40001' } },
        { id: 'private', text: { en: '192.168.1.10:49152', ja: '192.168.1.10:49152' } },
        { id: 'router-lan', text: { en: '192.168.1.1:49152', ja: '192.168.1.1:49152' } },
      ],
      answerId: 'public',
      explanation: {
        en: 'The server only sees the translated source: the router’s public address and the external port it chose.',
        ja: 'サーバーに見えるのは変換した後の送信元、つまりルーターのグローバルアドレスと、ルーターが選んだ外側のポートだけ。',
      },
    },
    {
      id: 'inbound',
      prompt: {
        en: 'A SYN from the Internet arrives at 203.0.113.5:80, and the NAT table has no row for it. What does a typical home router do?',
        ja: 'インターネットから 203.0.113.5:80 に SYN が届き、NAT の変換表に当てはまる行がない。ふつうの家庭のルーターはどうする？',
      },
      choices: [
        {
          id: 'all',
          text: { en: 'Sends it to every PC on the LAN', ja: 'LAN のすべての PC に送る' },
        },
        {
          id: 'first',
          text: { en: 'Sends it to the first PC in the table', ja: '変換表の最初の PC に送る' },
        },
        {
          id: 'drop',
          text: {
            en: 'Drops it, unless port forwarding is set up',
            ja: 'ポートフォワーディングを設定していなければ捨てる',
          },
        },
      ],
      answerId: 'drop',
      explanation: {
        en: 'Without a mapping, the router does not know which PC the packet is for. To accept connections from outside, you add a static mapping (port forwarding).',
        ja: '対応がなければ、どの PC 宛てのパケットかルーターにはわからない。外からの接続を受けるには、対応を手で書いておく（ポートフォワーディング）。',
      },
    },
  ],
}
