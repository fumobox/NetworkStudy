import type { Quiz } from '@/components/features/quiz/types'

/** BGP とエニーキャストの理解度クイズ（根拠: RFC 4271 §4.2・§6.5・§8.2.2・§9.1.2・§9.1.2.2、RFC 9293 §3.10.7.1、RFC 7094 §4.2、RFC 4786 §4.1） */
export const bgpAnycastQuiz: Quiz = {
  id: 'bgp-anycast',
  questions: [
    {
      id: 'shorter',
      prompt: {
        en: 'The ISP has two routes to 203.0.113.0/24: AS_PATH 64511 from Site A, and 64500 64511 from the transit provider. No local preference is configured. Which one does it use?',
        ja: 'ISP は 203.0.113.0/24 への経路を 2 つ持つ。拠点 A からの AS_PATH 64511 と、トランジット事業者からの 64500 64511。ローカルな優先度は設定していない。どちらを使う？',
      },
      choices: [
        {
          id: 'first',
          text: { en: 'The one that arrived first', ja: '先に届いた方' },
        },
        {
          id: 'next-hop',
          text: {
            en: 'The one with the lower NEXT_HOP address',
            ja: 'NEXT_HOP のアドレスが小さい方',
          },
        },
        {
          id: 'short',
          text: {
            en: 'The one from Site A: its AS_PATH is shorter',
            ja: '拠点 A からの経路。AS_PATH が短い',
          },
        },
      ],
      answerId: 'short',
      explanation: {
        en: 'Among routes that are equally preferred, BGP first picks the one whose AS_PATH has the fewest ASes (RFC 4271 §9.1.2.2). 64511 is one AS, 64500 64511 is two. Arrival order does not matter, and addresses only break ties much later.',
        ja: '同じだけ好まれる経路の中から、BGP はまず AS_PATH の AS がいちばん少ないものを選ぶ（RFC 4271 §9.1.2.2）。64511 は AS 1 つ、64500 64511 は 2 つ。届いた順は関係なく、アドレスで決めるのはずっと後の、同点のときだけ。',
      },
    },
    {
      id: 'loop',
      prompt: {
        en: 'A router in AS 64511 receives an UPDATE whose AS_PATH is 64500 64511. What does it do?',
        ja: 'AS 64511 のルーターが、AS_PATH が 64500 64511 の UPDATE を受け取る。どうする？',
      },
      choices: [
        {
          id: 'use',
          text: { en: 'Uses it, as a route of length 2', ja: '長さ 2 の経路として使う' },
        },
        {
          id: 'ignore',
          text: {
            en: 'Does not use it: its own AS is in the path, so it is a loop',
            ja: '使わない。経路に自分の AS があるので、ループ',
          },
        },
        {
          id: 'notify',
          text: {
            en: 'Sends NOTIFICATION and closes the session',
            ja: 'NOTIFICATION を送ってセッションを閉じる',
          },
        },
      ],
      answerId: 'ignore',
      explanation: {
        en: 'Seeing its own AS number in AS_PATH means the route has already passed through this AS, so using it would create a loop. The route is simply excluded (RFC 4271 §9.1.2); it is not an error, and the session stays up.',
        ja: 'AS_PATH に自分の AS 番号があるのは、経路がもうこの AS を通ってきたということで、使うとループになる。経路はただ除かれる（RFC 4271 §9.1.2）。誤りではないので、セッションはそのまま続く。',
      },
    },
    {
      id: 'silent',
      prompt: {
        en: 'Site A loses power without sending anything. The negotiated Hold Time is 90 seconds. When does the ISP stop sending traffic there?',
        ja: '拠点 A が何も送らずに電源を失う。合意した Hold Time は 90 秒。ISP が拠点 A への転送をやめるのはいつ？',
      },
      choices: [
        {
          id: 'hold',
          text: {
            en: 'When its Hold Timer expires, about 90 seconds after the last message from Site A',
            ja: 'Hold Timer が切れたとき。拠点 A からの最後のメッセージの約 90 秒後',
          },
        },
        {
          id: 'next-keepalive',
          text: {
            en: 'At its next KEEPALIVE, 30 seconds later',
            ja: '次の KEEPALIVE を送ったとき。30 秒後',
          },
        },
        {
          id: 'immediately',
          text: {
            en: 'Immediately, because the TCP connection breaks',
            ja: 'すぐ。TCP の接続が切れるから',
          },
        },
      ],
      answerId: 'hold',
      explanation: {
        en: 'A KEEPALIVE that gets no answer tells the sender nothing by itself, and nothing closes the TCP connection when the peer simply disappears. Only when nothing has arrived for the whole Hold Time does the ISP send NOTIFICATION (Hold Timer Expired), close the session and delete the routes learned over it (RFC 4271 §6.5, §8.2.2). Until then, traffic to Site A is lost.',
        ja: '答えのない KEEPALIVE を送っても、それだけでは何もわからず、相手がただ消えたときは、TCP の接続を閉じるものもない。Hold Time のあいだ何も届かなかったときに、ISP は NOTIFICATION（Hold Timer Expired）を送ってセッションを閉じ、そこで受け取った経路を消す（RFC 4271 §6.5、§8.2.2）。それまで、拠点 A への通信は失われる。',
      },
    },
    {
      id: 'tcp',
      prompt: {
        en: 'A TCP connection to the anycast address is open at Site A. The best path changes to Site B. What happens to the next segment?',
        ja: 'エニーキャストのアドレスへの TCP の接続が、拠点 A で開いている。最良経路が拠点 B に変わる。次のセグメントはどうなる？',
      },
      choices: [
        {
          id: 'continues',
          text: {
            en: 'Site B continues the connection, because the address is the same',
            ja: 'アドレスが同じなので、拠点 B が接続を続ける',
          },
        },
        {
          id: 'forwarded',
          text: {
            en: 'Site B forwards it to Site A',
            ja: '拠点 B が拠点 A に転送する',
          },
        },
        {
          id: 'reset',
          text: {
            en: 'Site B has no such connection and answers with a reset',
            ja: '拠点 B にはその接続がなく、リセットで答える',
          },
        },
      ],
      answerId: 'reset',
      explanation: {
        en: 'The connection’s state exists only at Site A. Site B receives a segment for a connection it does not know and answers with RST (RFC 9293 §3.10.7.1), so the connection breaks. A query over UDP would simply be answered by Site B. That is why anycast suits short, connectionless exchanges (RFC 7094 §4.2), and why routing must stay stable for much longer than a typical connection (RFC 4786 §4.1).',
        ja: '接続の状態は拠点 A にしかない。拠点 B は知らない接続へのセグメントを受け取り、RST で答える（RFC 9293 §3.10.7.1）ので、接続は切れる。UDP の問い合わせなら、拠点 B がそのまま答える。だからエニーキャストは短く接続のないやり取りに向き（RFC 7094 §4.2）、経路はふつうの接続よりずっと長く安定している必要がある（RFC 4786 §4.1）。',
      },
    },
  ],
}
