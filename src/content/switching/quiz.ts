import type { Quiz } from '@/components/features/quiz/types'

/** スイッチの理解度クイズ（根拠: IEEE Std 802.1Q-2022 clause 8.6、8.7、8.8.3、RFC 4188） */
export const switchingQuiz: Quiz = {
  id: 'switching',
  questions: [
    {
      id: 'learn',
      prompt: {
        en: 'A frame from 00:00:5e:00:53:0a to 00:00:5e:00:53:01 enters a switch on port 1. What does the switch add to its MAC address table?',
        ja: '00:00:5e:00:53:0a から 00:00:5e:00:53:01 へのフレームが、スイッチのポート 1 に入った。スイッチが MAC アドレステーブルに加えるのは？',
      },
      choices: [
        {
          id: 'src',
          text: {
            en: '00:00:5e:00:53:0a is behind port 1',
            ja: '00:00:5e:00:53:0a はポート 1 の先',
          },
        },
        {
          id: 'dst',
          text: {
            en: '00:00:5e:00:53:01 is behind port 1',
            ja: '00:00:5e:00:53:01 はポート 1 の先',
          },
        },
        {
          id: 'both',
          text: { en: 'Both addresses are behind port 1', ja: '両方のアドレスがポート 1 の先' },
        },
      ],
      answerId: 'src',
      explanation: {
        en: 'A switch learns only from the source address: the sender is certainly behind the port the frame came in on. Where the destination is, the frame does not tell.',
        ja: 'スイッチが学習するのは送信元のアドレスだけ。送った機器は、フレームが入ってきたポートの先に必ずいる。宛先がどこにいるかは、フレームからはわからない。',
      },
    },
    {
      id: 'unknown',
      prompt: {
        en: 'The destination MAC address of a frame is not in the table. What does the switch do?',
        ja: 'フレームの宛先の MAC アドレスが表にない。スイッチはどうする？',
      },
      choices: [
        { id: 'drop', text: { en: 'It drops the frame', ja: 'フレームを捨てる' } },
        {
          id: 'arp',
          text: {
            en: 'It sends an ARP request to find the destination',
            ja: '宛先を探すため ARP の要求を送る',
          },
        },
        {
          id: 'flood',
          text: {
            en: 'It sends the frame out of every port except the one it came in on',
            ja: '入ってきたポート以外のすべてのポートにフレームを送る',
          },
        },
      ],
      answerId: 'flood',
      explanation: {
        en: 'This is flooding. The right device receives the frame and the others drop it. When the destination answers, the switch learns its port from the answer’s source address.',
        ja: 'これがフラッディング。正しい機器はフレームを受け取り、ほかの機器は捨てる。宛先が答えれば、スイッチはその答えの送信元のアドレスからポートを学習する。スイッチは ARP を使わない。',
      },
    },
    {
      id: 'broadcast',
      prompt: {
        en: 'The switch knows the ports of all devices. Where does it send a frame to ff:ff:ff:ff:ff:ff?',
        ja: 'スイッチはすべての機器のポートを知っている。ff:ff:ff:ff:ff:ff 宛てのフレームはどこに送る？',
      },
      choices: [
        {
          id: 'all',
          text: {
            en: 'Every port except the one it came in on',
            ja: '入ってきたポート以外のすべてのポート',
          },
        },
        {
          id: 'none',
          text: {
            en: 'Nowhere: nobody has that address',
            ja: 'どこにも送らない。そのアドレスの機器はいない',
          },
        },
        {
          id: 'router',
          text: { en: 'Only the port of the router', ja: 'ルーターのポートだけ' },
        },
      ],
      answerId: 'all',
      explanation: {
        en: 'ff:ff:ff:ff:ff:ff is the broadcast address: the frame is meant for every device, so the switch always floods it, whatever its table says. This is how ARP requests reach everyone.',
        ja: 'ff:ff:ff:ff:ff:ff はブロードキャストのアドレスで、すべての機器に宛てたもの。スイッチは表の内容に関係なく、いつも全ポートに流す。ARP の要求がみんなに届くのはこのため。',
      },
    },
    {
      id: 'ageing',
      prompt: {
        en: 'Why does a switch remove entries that have not been used for a while (ageing)?',
        ja: 'スイッチが、しばらく使われない行を消す（エージング）のはなぜ？',
      },
      choices: [
        {
          id: 'move',
          text: {
            en: 'So that a device that moved to another port is not sent frames on its old port forever',
            ja: '別のポートに移った機器に、古いポートでフレームを送り続けないように',
          },
        },
        {
          id: 'security',
          text: { en: 'To encrypt the table', ja: '表を暗号化するため' },
        },
        {
          id: 'speed',
          text: { en: 'To make frames travel faster', ja: 'フレームを速く届けるため' },
        },
      ],
      answerId: 'move',
      explanation: {
        en: 'After an entry ages out (300 seconds by default), frames to that device are flooded again, so they reach it wherever it is now, and the switch learns its new port when it sends. It also keeps the table from filling up.',
        ja: '行が消える（既定では 300 秒）と、その機器宛てのフレームはまた流されるので、今どこにいても届き、その機器が送ったときに新しいポートを学習する。表がいっぱいになるのも防ぐ。',
      },
    },
  ],
}
