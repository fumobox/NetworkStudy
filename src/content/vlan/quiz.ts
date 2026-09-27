import type { Quiz } from '@/components/features/quiz/types'

/** VLAN の理解度クイズ（根拠: IEEE Std 802.1Q-2022 clause 8.6、9.5、9.6、RFC 1812 §5.2、§5.3.1） */
export const vlanQuiz: Quiz = {
  id: 'vlan',
  questions: [
    {
      id: 'broadcast',
      prompt: {
        en: 'Ports 1 and 2 are in VLAN 10, port 3 is in VLAN 20, and port 4 is a trunk carrying both. A PC on port 1 sends a broadcast. Where does it go?',
        ja: 'ポート 1 と 2 は VLAN 10、ポート 3 は VLAN 20、ポート 4 は両方を運ぶトランク。ポート 1 の PC がブロードキャストを送った。どこに届く？',
      },
      choices: [
        { id: 'all', text: { en: 'Ports 2, 3 and 4', ja: 'ポート 2、3、4' } },
        { id: 'vlan', text: { en: 'Ports 2 and 4', ja: 'ポート 2 と 4' } },
        { id: 'port2', text: { en: 'Port 2 only', ja: 'ポート 2 だけ' } },
      ],
      answerId: 'vlan',
      explanation: {
        en: 'A broadcast stays inside its VLAN: it goes to the other VLAN 10 access port and to the trunk, which carries VLAN 10. Port 3 belongs to VLAN 20 and receives nothing.',
        ja: 'ブロードキャストは VLAN の中にとどまる。VLAN 10 のもう 1 つのアクセスポートと、VLAN 10 を運ぶトランクに届く。ポート 3 は VLAN 20 なので何も届かない。',
      },
    },
    {
      id: 'tag',
      prompt: {
        en: 'What does the 802.1Q tag on a trunk frame carry, and where is it removed?',
        ja: 'トランクのフレームに付く 802.1Q のタグは何を運び、どこで外される？',
      },
      choices: [
        {
          id: 'vid',
          text: {
            en: 'The VLAN ID; the switch removes it before sending the frame out of an access port',
            ja: 'VLAN ID。スイッチがアクセスポートから送る前に外す',
          },
        },
        {
          id: 'ip',
          text: {
            en: 'The destination IP address; the router removes it',
            ja: '宛先の IP アドレス。ルーターが外す',
          },
        },
        {
          id: 'pc',
          text: {
            en: 'The VLAN ID; every PC removes it when it receives the frame',
            ja: 'VLAN ID。PC がフレームを受け取るときに外す',
          },
        },
      ],
      answerId: 'vid',
      explanation: {
        en: 'The tag (TPID 0x8100 and a 12-bit VLAN ID) tells the other end of a trunk which VLAN the frame belongs to. On an access port the port itself decides the VLAN, so frames there have no tag and the PCs never see one.',
        ja: 'タグ（TPID 0x8100 と 12 ビットの VLAN ID）は、トランクの相手にフレームがどの VLAN のものかを伝える。アクセスポートではポートで VLAN が決まるので、フレームにタグはなく、PC はタグを見ない。',
      },
    },
    {
      id: 'router',
      prompt: {
        en: 'PC A (VLAN 10) and PC C (VLAN 20) are plugged into the same switch. How does a packet from PC A reach PC C?',
        ja: 'PC A（VLAN 10）と PC C（VLAN 20）は同じスイッチにつながっている。PC A のパケットはどうやって PC C に届く？',
      },
      choices: [
        {
          id: 'switch',
          text: {
            en: 'The switch forwards it directly, because both are on the same switch',
            ja: '同じスイッチなので、スイッチが直接転送する',
          },
        },
        {
          id: 'router',
          text: {
            en: 'It goes to a router, which forwards it from VLAN 10 to VLAN 20',
            ja: 'ルーターに送られ、ルーターが VLAN 10 から VLAN 20 に転送する',
          },
        },
        {
          id: 'never',
          text: {
            en: 'It cannot: different VLANs can never talk to each other',
            ja: '届かない。別の VLAN どうしは通信できない',
          },
        },
      ],
      answerId: 'router',
      explanation: {
        en: 'A switch never moves a frame between VLANs. Each VLAN is a separate network (here a separate subnet), so traffic between them is routed, like traffic between any two networks. An L3 switch can do this routing inside the same box.',
        ja: 'スイッチはフレームを VLAN の間で移さない。VLAN はそれぞれ別のネットワーク（ここでは別のサブネット）なので、その間の通信は、ほかのネットワークどうしと同じくルーターが転送する。L3 スイッチなら、同じ機器の中でこの転送もできる。',
      },
    },
    {
      id: 'benefit',
      prompt: {
        en: 'Why split one LAN into VLANs?',
        ja: '1 つの LAN を VLAN に分けるのはなぜ？',
      },
      choices: [
        {
          id: 'speed',
          text: {
            en: 'To make each cable faster',
            ja: 'ケーブルを速くするため',
          },
        },
        {
          id: 'scope',
          text: {
            en: 'To keep broadcasts and traffic of different groups apart without buying separate switches',
            ja: '別々のスイッチを買わずに、グループごとにブロードキャストと通信を分けるため',
          },
        },
        {
          id: 'ip',
          text: {
            en: 'Because IP addresses cannot be used without VLANs',
            ja: 'VLAN がないと IP アドレスを使えないから',
          },
        },
      ],
      answerId: 'scope',
      explanation: {
        en: 'Without VLANs, every broadcast reaches every device, and every device can reach every other one directly. VLANs split one switch into several separate networks, for example for staff, guests and phones, and traffic between them has to pass a router, where it can be filtered.',
        ja: 'VLAN がなければ、どのブロードキャストもすべての機器に届き、どの機器もほかの機器に直接届く。VLAN は 1 台のスイッチを、たとえば社員用・来客用・電話用の別々のネットワークに分ける。その間の通信はルーターを通るので、そこで制限もできる。',
      },
    },
  ],
}
