import type { Quiz } from '@/components/features/quiz/types'

/** ARP スプーフィングと DAI の理解度クイズ（根拠: RFC 826「Packet Reception」、RFC 5227 §2.4、Cisco IOS XE「Configuring Dynamic ARP Inspection」、RFC 7513 §6） */
export const arpSpoofingQuiz: Quiz = {
  id: 'arp-spoofing',
  questions: [
    {
      id: 'unsolicited',
      prompt: {
        en: 'PC A never sent an ARP request, yet one ARP reply changed the MAC address it has for its gateway. Why did PC A accept it?',
        ja: 'PC A は ARP の要求を送っていないのに、1 つの ARP の応答で、ゲートウェイの MAC アドレスが書き換わった。PC A はなぜ受け入れた？',
      },
      choices: [
        {
          id: 'switch',
          text: {
            en: 'The switch vouched for it by forwarding it',
            ja: 'スイッチが転送したので、保証されたから',
          },
        },
        {
          id: 'merge',
          text: {
            en: 'ARP updates an existing entry from any packet whose sender IP address it has',
            ja: 'ARP は、送信元の IP アドレスの行があれば、どのパケットでもその行を書き換える',
          },
        },
        {
          id: 'broadcast',
          text: {
            en: 'Broadcast replies are always trusted',
            ja: 'ブロードキャストの応答はいつも信頼されるから',
          },
        },
      ],
      answerId: 'merge',
      explanation: {
        en: 'RFC 826 merges the sender’s address into the table before it even looks at whether the packet is a request or a reply, and nothing ties a reply to an earlier request. PC A already had an entry for its gateway, 192.168.1.1, so the forged reply simply overwrote it. The reply was unicast, and the switch only forwards frames; it does not check ARP.',
        ja: 'RFC 826 は、要求か応答かを見る前に、送信元のアドレスを表に取り込む。応答を前の要求と結びつけるものもない。PC A にはゲートウェイの行がもうあったので、偽の応答はそれを書き換えた。応答はユニキャストで、スイッチはフレームを転送するだけで ARP は確かめない。',
      },
    },
    {
      id: 'dai-compare',
      prompt: {
        en: 'With Dynamic ARP Inspection, what does the switch compare an ARP packet from an untrusted port against?',
        ja: 'Dynamic ARP Inspection では、信頼しないポートから届いた ARP のパケットを、スイッチは何と照らし合わせる？',
      },
      choices: [
        {
          id: 'mac-table',
          text: { en: 'Its MAC address table', ja: 'MAC アドレステーブル' },
        },
        {
          id: 'gateway-cache',
          text: { en: 'The gateway’s ARP cache', ja: 'ゲートウェイの ARP キャッシュ' },
        },
        {
          id: 'bindings',
          text: {
            en: 'The DHCP snooping binding table (and any ARP ACL)',
            ja: 'DHCP スヌーピングの束縛表（と ARP ACL）',
          },
        },
      ],
      answerId: 'bindings',
      explanation: {
        en: 'The switch records which IP address belongs to which MAC address when the DHCP server’s DHCPACK passes through a trusted port. DAI permits an ARP packet only if its sender pair (SPA and SHA) is in that table or in an ARP ACL. The MAC address table cannot help: the forged frame’s source MAC address is the attacker’s real one.',
        ja: 'スイッチは、DHCP サーバーの DHCPACK が信頼するポートを通るときに、どの IP アドレスがどの MAC アドレスのものかを記録する。DAI は、送信元の組（SPA と SHA）がその表か ARP ACL にある ARP のパケットだけを通す。MAC アドレステーブルは役に立たない。偽のフレームの送信元の MAC アドレスは、攻撃者の本物だから。',
      },
    },
    {
      id: 'printer',
      prompt: {
        en: 'A printer with a manually configured IP address is plugged into a port where DAI is on. What happens?',
        ja: '手で IP アドレスを設定したプリンターを、DAI が有効なポートにつなぐ。どうなる？',
      },
      choices: [
        {
          id: 'trusted',
          text: {
            en: 'It works: static addresses are trusted automatically',
            ja: '使える。静的なアドレスは自動で信頼される',
          },
        },
        {
          id: 'learned',
          text: {
            en: 'It works: DAI learns the pair from its first ARP request',
            ja: '使える。DAI は最初の ARP の要求から組を学ぶ',
          },
        },
        {
          id: 'dropped',
          text: {
            en: 'Its own ARP packets are dropped until an ARP ACL lists it',
            ja: 'ARP ACL に書くまで、プリンター自身の ARP のパケットが捨てられる',
          },
        },
      ],
      answerId: 'dropped',
      explanation: {
        en: 'DAI only trusts pairs it has a reason to believe. The printer never used DHCP, so there is no binding, and an unknown pair looks exactly like a forged one. The administrator lists such hosts in an ARP ACL, which DAI checks before the binding table. Learning from ARP itself would defeat the purpose.',
        ja: 'DAI が信じるのは、信じる理由のある組だけ。プリンターは DHCP を使っていないので束縛がなく、知らない組は偽物とまったく同じに見える。管理者はこうしたホストを ARP ACL に書き、DAI は束縛表より先にそれを見る。ARP そのものから学んだら、確かめる意味がなくなる。',
      },
    },
    {
      id: 'no-defence',
      prompt: {
        en: 'RFC 5227 lets a host defend its address when it sees another MAC address claim it. Why did the gateway not defend itself in the attack shown?',
        ja: 'RFC 5227 では、自分のアドレスを別の MAC アドレスが名乗るのを見たホストは、アドレスを守れる。示した攻撃で、ゲートウェイはなぜ守らなかった？',
      },
      choices: [
        {
          id: 'unseen',
          text: {
            en: 'The forged reply went only to PC A, so the gateway never saw it',
            ja: '偽の応答は PC A にだけ送られ、ゲートウェイには届かなかった',
          },
        },
        {
          id: 'routers',
          text: {
            en: 'Routers are not allowed to defend their addresses',
            ja: 'ルーターは、アドレスを守ってはいけない',
          },
        },
        {
          id: 'boot',
          text: {
            en: 'RFC 5227 applies only while a host is starting up',
            ja: 'RFC 5227 が使えるのは、ホストの起動中だけ',
          },
        },
      ],
      answerId: 'unseen',
      explanation: {
        en: 'A host can only react to packets it receives. The attacker sent the reply as unicast to PC A, and the switch delivered it only there. RFC 5227 §2.4 even suggests that hosts such as a default router keep defending their address, but only against conflicts they see.',
        ja: 'ホストが反応できるのは、受け取ったパケットだけ。攻撃者は応答を PC A へのユニキャストで送り、スイッチはそこにだけ届けた。RFC 5227 §2.4 は、既定のルーターのようなホストにはアドレスを守り続けることまで勧めているが、守れるのは見えた衝突だけ。',
      },
    },
  ],
}
