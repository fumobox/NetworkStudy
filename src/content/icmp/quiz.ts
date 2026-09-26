import type { Quiz } from '@/components/features/quiz/types'

/** ICMP の理解度クイズ（根拠: RFC 792、RFC 1122 §3.2.1.7、§4.1.3.1、RFC 1812 §4.3.2.4、§4.3.2.8、§5.3.1） */
export const icmpQuiz: Quiz = {
  id: 'icmp',
  questions: [
    {
      id: 'ttl',
      prompt: {
        en: 'How does traceroute find the routers on the path?',
        ja: 'traceroute は、どうやって途中のルーターを調べる？',
      },
      choices: [
        {
          id: 'ask',
          text: {
            en: 'It asks each router for its routing table',
            ja: '各ルーターに経路表を尋ねる',
          },
        },
        {
          id: 'ttl',
          text: {
            en: 'It sends probes with TTL 1, 2, 3 …, and each router where TTL runs out answers',
            ja: 'TTL を 1、2、3…にしてプローブを送り、TTL が尽きたルーターが答える',
          },
        },
        {
          id: 'dns',
          text: { en: 'It looks up the path in DNS', ja: 'DNS で経路を調べる' },
        },
      ],
      answerId: 'ttl',
      explanation: {
        en: 'Each router decreases TTL by 1. When it reaches 0, the router drops the packet and sends Time Exceeded from its own address, which reveals that hop.',
        ja: 'ルーターは TTL を 1 ずつ減らす。0 になると、ルーターはパケットを捨てて自分のアドレスから Time Exceeded を返すので、そのホップがわかる。',
      },
    },
    {
      id: 'source',
      prompt: {
        en: 'A probe’s TTL runs out at the ISP router (203.0.113.1). What is the source address of the Time Exceeded message?',
        ja: 'プローブの TTL が ISP のルーター（203.0.113.1）で尽きた。Time Exceeded の送信元のアドレスは？',
      },
      choices: [
        { id: 'server', text: { en: '192.0.2.10 (the destination)', ja: '192.0.2.10（宛先）' } },
        { id: 'pc', text: { en: '192.168.1.10 (the PC)', ja: '192.168.1.10（PC）' } },
        {
          id: 'home',
          text: { en: '192.168.1.1 (the home router)', ja: '192.168.1.1（家庭のルーター）' },
        },
        {
          id: 'isp',
          text: { en: '203.0.113.1 (the ISP router)', ja: '203.0.113.1（ISP のルーター）' },
        },
      ],
      answerId: 'isp',
      explanation: {
        en: 'The ICMP error comes from the router that dropped the packet, using its own address. That is how traceroute learns the address of each hop.',
        ja: 'ICMP のエラーは、パケットを捨てたルーターが自分のアドレスから送る。それで traceroute は各ホップのアドレスを知る。',
      },
    },
    {
      id: 'star',
      prompt: {
        en: 'traceroute prints * for hop 2 but reaches the destination at hop 3. What does that mean?',
        ja: 'traceroute が 2 ホップ目に * を表示したが、3 ホップ目で宛先に届いた。どういうこと？',
      },
      choices: [
        {
          id: 'broken',
          text: { en: 'The path is broken at hop 2', ja: '経路が 2 ホップ目で切れている' },
        },
        {
          id: 'silent',
          text: {
            en: 'The router at hop 2 did not send Time Exceeded, but it forwards packets',
            ja: '2 ホップ目のルーターは Time Exceeded を返さなかったが、パケットは転送している',
          },
        },
        {
          id: 'skip',
          text: { en: 'There is no router at hop 2', ja: '2 ホップ目にはルーターがない' },
        },
      ],
      answerId: 'silent',
      explanation: {
        en: 'Routers may rate-limit ICMP errors, and some are configured not to send them. Since hop 3 answered, the packets did pass through hop 2.',
        ja: 'ルーターは ICMP のエラーの量を制限してよく、送らないように設定されていることもある。3 ホップ目が答えたので、パケットは 2 ホップ目を通っている。',
      },
    },
    {
      id: 'udp',
      prompt: {
        en: 'Why does a traceroute with UDP probes end with Port Unreachable from the destination?',
        ja: 'UDP のプローブを使う traceroute が、宛先の Port Unreachable で終わるのはなぜ？',
      },
      choices: [
        {
          id: 'closed',
          text: {
            en: 'The probes go to a high port where nothing listens, so the destination reports it',
            ja: 'プローブは誰も待ち受けていない大きい番号のポートに送るので、宛先がそれを知らせる',
          },
        },
        {
          id: 'firewall',
          text: {
            en: 'Because a firewall blocks all UDP',
            ja: 'ファイアウォールがすべての UDP を止めるから',
          },
        },
        {
          id: 'ttl',
          text: { en: 'Because the TTL ran out at the destination', ja: '宛先で TTL が尽きたから' },
        },
      ],
      answerId: 'closed',
      explanation: {
        en: 'A host must not discard a packet just because its TTL is 1, so the last probe is delivered. Nothing is expected to listen on port 33434 and above, so the destination answers with Port Unreachable (3/3), and traceroute knows it has arrived.',
        ja: 'ホストは TTL が 1 というだけではパケットを捨てないので、最後のプローブは届く。33434 番以降のポートでは普通は誰も待ち受けていないので、宛先が Port Unreachable（3/3）で答え、traceroute は着いたことを知る。',
      },
    },
  ],
}
