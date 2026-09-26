import type { Quiz } from '@/components/features/quiz/types'

/** ARP の理解度クイズ（根拠は scenario.ts の RFC 826、RFC 1122 の参照と同じ） */
export const arpQuiz: Quiz = {
  id: 'arp',
  questions: [
    {
      id: 'request-destination',
      prompt: {
        en: 'Where is an ARP request sent?',
        ja: 'ARP の要求はどこ宛てに送る？',
      },
      choices: [
        {
          id: 'router',
          text: { en: 'To the router’s MAC address', ja: 'ルーターの MAC アドレス' },
        },
        { id: 'dns', text: { en: 'To the DNS server', ja: 'DNS サーバー' } },
        {
          id: 'broadcast',
          text: {
            en: 'To the broadcast address ff:ff:ff:ff:ff:ff',
            ja: 'ブロードキャストアドレス ff:ff:ff:ff:ff:ff',
          },
        },
      ],
      answerId: 'broadcast',
      explanation: {
        en: 'The PC does not know the MAC address yet, so it asks everyone on the LAN at once. Only the device that owns the IP address answers.',
        ja: 'PC はまだ MAC アドレスを知らないので、LAN の全員にまとめて尋ねる。答えるのは、その IP アドレスを持つ機器だけ。',
      },
    },
    {
      id: 'reply-unicast',
      prompt: {
        en: 'Why is the ARP reply sent by unicast, not broadcast?',
        ja: 'ARP の応答が、ブロードキャストではなくユニキャストで送られるのはなぜ？',
      },
      choices: [
        {
          id: 'known',
          text: {
            en: 'The request already told the sender’s MAC address',
            ja: '要求に、送った側の MAC アドレスが入っていたから',
          },
        },
        {
          id: 'secure',
          text: { en: 'To encrypt the reply', ja: '応答を暗号化するため' },
        },
        {
          id: 'router',
          text: {
            en: 'Because routers do not forward broadcasts',
            ja: 'ルーターはブロードキャストを転送しないから',
          },
        },
      ],
      answerId: 'known',
      explanation: {
        en: 'The request carries the sender’s MAC address (SHA), so the device that answers can send the reply straight to it.',
        ja: '要求には送った側の MAC アドレス（SHA）が入っているので、答える機器は応答をその PC に直接送れる。',
      },
    },
    {
      id: 'remote',
      prompt: {
        en: 'The PC (192.168.1.10/24) sends a packet to 192.0.2.10. Whose MAC address does it look up with ARP?',
        ja: 'PC（192.168.1.10/24）が 192.0.2.10 にパケットを送る。ARP で調べるのは誰の MAC アドレス？',
      },
      choices: [
        { id: 'server', text: { en: '192.0.2.10 (the server)', ja: '192.0.2.10（サーバー）' } },
        {
          id: 'gateway',
          text: {
            en: '192.168.1.1 (the default gateway)',
            ja: '192.168.1.1（デフォルトゲートウェイ）',
          },
        },
        {
          id: 'none',
          text: { en: 'Nobody: ARP is not needed', ja: '誰のものも調べない（ARP は要らない）' },
        },
      ],
      answerId: 'gateway',
      explanation: {
        en: '192.0.2.10 is on another network, so the frame goes to the next hop, the default gateway. The IP destination stays 192.0.2.10.',
        ja: '192.0.2.10 は別のネットワークにあるので、フレームは次のホップのデフォルトゲートウェイに送る。IP の宛先は 192.0.2.10 のまま。',
      },
    },
    {
      id: 'cache',
      prompt: {
        en: 'What is the ARP cache for?',
        ja: 'ARP キャッシュは何のためにある？',
      },
      choices: [
        {
          id: 'dns',
          text: {
            en: 'To remember names and IP addresses',
            ja: '名前と IP アドレスの対応を覚えるため',
          },
        },
        {
          id: 'repeat',
          text: {
            en: 'To avoid asking for the same MAC address for every packet',
            ja: 'パケットのたびに同じ MAC アドレスを尋ねずに済ませるため',
          },
        },
        {
          id: 'route',
          text: { en: 'To choose the route to the destination', ja: '宛先までの経路を選ぶため' },
        },
        {
          id: 'lease',
          text: { en: 'To hand out IP addresses', ja: 'IP アドレスを配るため' },
        },
      ],
      answerId: 'repeat',
      explanation: {
        en: 'Once an IP address has been resolved, the answer is kept for a while, so the next packets to the same next hop can be sent at once. Names are DNS’s job, routes the routing table’s, addresses DHCP’s.',
        ja: '一度調べた答えはしばらく覚えておくので、同じネクストホップへの次のパケットはすぐに送れる。名前は DNS、経路は経路表、アドレスの配布は DHCP の役目。',
      },
    },
  ],
}
