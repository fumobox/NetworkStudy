import type { Quiz } from '@/components/features/quiz/types'

/** IPv6 アドレスの理解度クイズ（根拠: RFC 5952 §4、RFC 4291 §2.5.6、§2.7.1、付録 A） */
export const ipv6AddressQuiz: Quiz = {
  id: 'ipv6-address',
  questions: [
    {
      id: 'canonical',
      prompt: {
        en: 'Which is the recommended way to write 2001:0db8:0000:0000:0001:0000:0000:0001?',
        ja: '2001:0db8:0000:0000:0001:0000:0000:0001 の推奨の書き方は？',
      },
      choices: [
        { id: 'first', text: { en: '2001:db8::1:0:0:1', ja: '2001:db8::1:0:0:1' } },
        { id: 'second', text: { en: '2001:db8:0:0:1::1', ja: '2001:db8:0:0:1::1' } },
        { id: 'both', text: { en: '2001:db8::1::1', ja: '2001:db8::1::1' } },
      ],
      answerId: 'first',
      explanation: {
        en: 'There are two runs of two zero groups. When they are the same length, :: replaces the first one. :: may appear only once, so 2001:db8::1::1 is not a valid address at all.',
        ja: '0 のグループが 2 つ続くところが 2 か所ある。同じ長さなら、最初のほうを :: にする。:: は 1 回しか使えないので、2001:db8::1::1 はアドレスとして正しくない。',
      },
    },
    {
      id: 'link-local',
      prompt: {
        en: 'Which address is a link-local address that routers never forward?',
        ja: 'ルーターが転送しない、リンクローカルアドレスはどれ？',
      },
      choices: [
        { id: 'global', text: { en: '2001:db8::1', ja: '2001:db8::1' } },
        { id: 'll', text: { en: 'fe80::1', ja: 'fe80::1' } },
        { id: 'ula', text: { en: 'fd00::1', ja: 'fd00::1' } },
      ],
      answerId: 'll',
      explanation: {
        en: 'Link-local addresses are in fe80::/10 and are valid only on one link. Every IPv6 interface has one. fd00::1 is a unique local address, used inside an organization.',
        ja: 'リンクローカルアドレスは fe80::/10 の範囲で、1 つのリンクの中だけで使える。IPv6 のどのインターフェースにもある。fd00::1 は組織の中で使うユニークローカルアドレス。',
      },
    },
    {
      id: 'all-nodes',
      prompt: {
        en: 'What is ff02::1?',
        ja: 'ff02::1 は何？',
      },
      choices: [
        { id: 'router', text: { en: 'The default router', ja: 'デフォルトルーター' } },
        { id: 'loopback', text: { en: 'The loopback address', ja: 'ループバックアドレス' } },
        {
          id: 'all',
          text: {
            en: 'A multicast group of all nodes on the link',
            ja: 'リンクのすべてのノードのマルチキャストのグループ',
          },
        },
      ],
      answerId: 'all',
      explanation: {
        en: 'ff00::/8 is multicast; the 2 means link-local scope, and group 1 is all nodes. IPv6 has no broadcast: packets for everyone on the link go to ff02::1. The loopback address is ::1.',
        ja: 'ff00::/8 はマルチキャストで、2 はリンクの中という範囲、グループ 1 はすべてのノード。IPv6 にはブロードキャストがなく、リンクの全員に送るパケットは ff02::1 宛てにする。ループバックアドレスは ::1。',
      },
    },
    {
      id: 'eui64',
      prompt: {
        en: 'How is an EUI-64 interface ID made from the MAC address 00:00:5e:00:53:0a?',
        ja: 'MAC アドレス 00:00:5e:00:53:0a から、EUI-64 のインターフェース ID をどう作る？',
      },
      choices: [
        {
          id: 'insert',
          text: {
            en: 'Insert ff:fe in the middle and flip the U/L bit: 0200:5eff:fe00:530a',
            ja: '中央に ff:fe を挟み、U/L ビットを反転する: 0200:5eff:fe00:530a',
          },
        },
        {
          id: 'pad',
          text: {
            en: 'Put two zero bytes in front: 0000:0000:5e00:530a',
            ja: '前に 0 のバイトを 2 つ付ける: 0000:0000:5e00:530a',
          },
        },
        {
          id: 'hash',
          text: {
            en: 'Hash the MAC address into 64 bits',
            ja: 'MAC アドレスを 64 ビットにハッシュする',
          },
        },
      ],
      answerId: 'insert',
      explanation: {
        en: 'The 48-bit MAC address is split in half, ff:fe goes in between, and the U/L bit of the first byte is flipped (00 becomes 02). Many systems now use random interface IDs instead, so that the MAC address is not revealed.',
        ja: '48 ビットの MAC アドレスを半分に分けて間に ff:fe を入れ、最初のバイトの U/L ビットを反転する（00 が 02 になる）。今は MAC アドレスを知られないよう、代わりにランダムなインターフェース ID を使う OS が多い。',
      },
    },
  ],
}
