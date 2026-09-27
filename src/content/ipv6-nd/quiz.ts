import type { Quiz } from '@/components/features/quiz/types'

/** IPv6 の SLAAC・近隣探索の理解度クイズ（根拠: RFC 4861 §4、§6.3.4、§7.2、RFC 4862 §5.4、§5.5.3） */
export const ipv6NdQuiz: Quiz = {
  id: 'ipv6-nd',
  questions: [
    {
      id: 'arp',
      prompt: {
        en: 'What does IPv6 use instead of ARP to find a neighbor’s MAC address?',
        ja: 'IPv6 では、隣の機器の MAC アドレスを調べるのに ARP の代わりに何を使う？',
      },
      choices: [
        {
          id: 'ns',
          text: {
            en: 'A Neighbor Solicitation to the neighbor’s solicited-node multicast address, answered by a Neighbor Advertisement',
            ja: '相手の要請ノードマルチキャストアドレスへの Neighbor Solicitation と、それへの Neighbor Advertisement',
          },
        },
        {
          id: 'broadcast',
          text: {
            en: 'An ARP request broadcast to ff:ff:ff:ff:ff:ff, as in IPv4',
            ja: 'IPv4 と同じく、ff:ff:ff:ff:ff:ff への ARP の要求のブロードキャスト',
          },
        },
        {
          id: 'dhcp',
          text: { en: 'A DHCPv6 server', ja: 'DHCPv6 のサーバー' },
        },
      ],
      answerId: 'ns',
      explanation: {
        en: 'IPv6 has no broadcast. Neighbor Discovery sends ICMPv6 messages to a multicast group that only devices with the same last 24 address bits join, so almost nobody else has to look at the question.',
        ja: 'IPv6 にはブロードキャストがない。近隣探索は、アドレスの下位 24 ビットが同じ機器だけが参加するマルチキャストのグループへ ICMPv6 のメッセージを送るので、ほかの機器はほとんど質問を見なくて済む。',
      },
    },
    {
      id: 'default-router',
      prompt: {
        en: 'After the Router Advertisement, what is the PC’s default router address?',
        ja: 'Router Advertisement のあと、PC のデフォルトルーターのアドレスは？',
      },
      choices: [
        { id: 'global', text: { en: '2001:db8:1::1', ja: '2001:db8:1::1' } },
        { id: 'multicast', text: { en: 'ff02::2', ja: 'ff02::2' } },
        {
          id: 'll',
          text: {
            en: 'The router’s link-local address (fe80::…)',
            ja: 'ルーターのリンクローカルアドレス（fe80::…）',
          },
        },
      ],
      answerId: 'll',
      explanation: {
        en: 'The router sends the Router Advertisement from its link-local address, and hosts use that address as the default router. It stays valid even if the global prefix changes.',
        ja: 'ルーターは Router Advertisement をリンクローカルアドレスから送り、ホストはそのアドレスをデフォルトルーターにする。グローバルのプレフィックスが変わっても使い続けられる。',
      },
    },
    {
      id: 'dad',
      prompt: {
        en: 'During duplicate address detection, what is the source address of the Neighbor Solicitation?',
        ja: '重複アドレス検出のとき、Neighbor Solicitation の送信元のアドレスは？',
      },
      choices: [
        {
          id: 'tentative',
          text: { en: 'The tentative address being checked', ja: '確かめている仮のアドレス' },
        },
        { id: 'unspecified', text: { en: 'The unspecified address ::', ja: '未指定アドレス ::' } },
        {
          id: 'loopback',
          text: { en: 'The loopback address ::1', ja: 'ループバックアドレス ::1' },
        },
      ],
      answerId: 'unspecified',
      explanation: {
        en: 'Until DAD succeeds, the PC may not use the address, so it asks from ::. If another device already uses it, the answer therefore goes to all nodes (ff02::1).',
        ja: 'DAD が終わるまで PC はそのアドレスを使えないので、:: から尋ねる。そのため、ほかの機器がすでに使っていれば、答えはすべてのノード（ff02::1）に送られる。',
      },
    },
    {
      id: 'slaac',
      prompt: {
        en: 'How does the PC get its global address with SLAAC?',
        ja: 'SLAAC で、PC はどうやってグローバルアドレスを手に入れる？',
      },
      choices: [
        {
          id: 'dhcp',
          text: {
            en: 'A DHCPv6 server leases it, like DHCP in IPv4',
            ja: 'IPv4 の DHCP のように、DHCPv6 のサーバーが貸し出す',
          },
        },
        {
          id: 'router',
          text: {
            en: 'The router picks it and sends it in the Router Advertisement',
            ja: 'ルーターが決めて、Router Advertisement で送る',
          },
        },
        {
          id: 'self',
          text: {
            en: 'The PC combines the advertised prefix with its own interface ID, then checks it with DAD',
            ja: 'PC が、知らされたプレフィックスと自分のインターフェース ID を組み合わせ、DAD で確かめる',
          },
        },
      ],
      answerId: 'self',
      explanation: {
        en: 'The Router Advertisement only carries the prefix, with the A flag allowing autoconfiguration. The PC builds the address itself, so no server has to keep track of it. The M and O flags tell hosts when DHCPv6 is needed instead or as well.',
        ja: 'Router Advertisement が運ぶのはプレフィックスだけで、A フラグが自動設定を許す。アドレスは PC が自分で作るので、それを管理するサーバーは要らない。代わりに、または一緒に DHCPv6 を使うときは、M と O のフラグで知らせる。',
      },
    },
  ],
}
