import type { Quiz } from '@/components/features/quiz/types'

/** 経路制御の理解度クイズ（根拠: RFC 1812 §5.2.4.3、RFC 4632 §5.1） */
export const routeLookupQuiz: Quiz = {
  id: 'route-lookup',
  questions: [
    {
      id: 'longest',
      prompt: {
        en: 'The table has 192.168.0.0/16 and 192.168.2.0/24. Which route is used for 192.168.2.5?',
        ja: '経路表に 192.168.0.0/16 と 192.168.2.0/24 がある。192.168.2.5 に使われる経路はどれ？',
      },
      choices: [
        { id: '16', text: { en: '192.168.0.0/16', ja: '192.168.0.0/16' } },
        { id: '24', text: { en: '192.168.2.0/24', ja: '192.168.2.0/24' } },
        { id: 'first', text: { en: 'Whichever comes first in the table', ja: '表で先にある方' } },
      ],
      answerId: '24',
      explanation: {
        en: 'Both match, but /24 is longer (more specific) than /16, so it wins.',
        ja: 'どちらも一致するが、/24 の方が /16 より長い（詳しい）ので、こちらが選ばれる。',
      },
    },
    {
      id: 'default',
      prompt: {
        en: 'When is the default route 0.0.0.0/0 used?',
        ja: 'デフォルト経路 0.0.0.0/0 が使われるのはいつ？',
      },
      choices: [
        {
          id: 'always',
          text: {
            en: 'For every packet, before other routes',
            ja: 'どのパケットにも、ほかの経路より先に',
          },
        },
        {
          id: 'lan',
          text: { en: 'Only for the local network', ja: '自分のネットワーク宛てのときだけ' },
        },
        {
          id: 'nothing-else',
          text: {
            en: 'When no more specific route matches',
            ja: 'もっと詳しい経路がどれも一致しないとき',
          },
        },
      ],
      answerId: 'nothing-else',
      explanation: {
        en: '/0 matches every address, but it is the shortest possible prefix, so any other matching route beats it.',
        ja: '/0 はどのアドレスにも一致するが、いちばん短いプレフィックスなので、一致するほかの経路があればそちらが勝つ。',
      },
    },
    {
      id: 'metric',
      prompt: {
        en: 'Two routes to 10.0.0.0/8 have metrics 20 and 10. Which one is used?',
        ja: '10.0.0.0/8 への経路が 2 つあり、メトリックは 20 と 10。使われるのはどちら？',
      },
      choices: [
        { id: '20', text: { en: 'The one with metric 20', ja: 'メトリック 20 の経路' } },
        { id: 'both', text: { en: 'Both, alternately', ja: '両方を交互に' } },
        { id: '10', text: { en: 'The one with metric 10', ja: 'メトリック 10 の経路' } },
      ],
      answerId: '10',
      explanation: {
        en: 'The prefixes are equally long, so the smaller metric (the “cheaper” route) wins. Some routers can also split traffic between equal routes (ECMP), which this page does not show.',
        ja: 'プレフィックスの長さが同じなので、メトリックの小さい（「安い」）経路が勝つ。同じ条件の経路に通信を分ける（ECMP）ルーターもあるが、このページでは扱わない。',
      },
    },
    {
      id: 'no-route',
      prompt: {
        en: 'A router has no matching route, not even a default route. What happens to the packet?',
        ja: 'ルーターに一致する経路がなく、デフォルト経路もない。パケットはどうなる？',
      },
      choices: [
        {
          id: 'unreachable',
          text: {
            en: 'It is dropped and ICMP Destination Unreachable is sent back',
            ja: '捨てられ、ICMP の Destination Unreachable が返る',
          },
        },
        {
          id: 'broadcast',
          text: {
            en: 'It is sent out of every interface',
            ja: 'すべてのインターフェースに送られる',
          },
        },
        {
          id: 'back',
          text: { en: 'It is sent back to the sender unchanged', ja: 'そのまま送信元に戻される' },
        },
      ],
      answerId: 'unreachable',
      explanation: {
        en: 'Without a route, the router cannot forward the packet. It drops it and reports “network unreachable” (type 3, code 0) to the sender.',
        ja: '経路がなければ、ルーターはパケットを転送できない。捨てて、送信元に「network unreachable」（type 3、code 0）を知らせる。',
      },
    },
  ],
}
