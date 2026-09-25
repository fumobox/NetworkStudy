import type { Quiz } from '@/components/features/quiz/types'

/** サブネット計算の理解度クイズ（根拠: RFC 4632、RFC 3021、RFC 1918） */
export const subnetCalculatorQuiz: Quiz = {
  id: 'subnet-calculator',
  questions: [
    {
      id: 'mask-of-26',
      prompt: {
        en: 'What is the subnet mask for a prefix length of /26?',
        ja: 'プレフィックス長 /26 のサブネットマスクはどれ？',
      },
      choices: [
        { id: '255.255.255.0', text: { en: '255.255.255.0', ja: '255.255.255.0' } },
        { id: '255.255.255.128', text: { en: '255.255.255.128', ja: '255.255.255.128' } },
        { id: '255.255.255.192', text: { en: '255.255.255.192', ja: '255.255.255.192' } },
        { id: '255.255.255.224', text: { en: '255.255.255.224', ja: '255.255.255.224' } },
      ],
      answerId: '255.255.255.192',
      explanation: {
        en: 'The first 24 bits give 255.255.255, and the remaining 2 network bits in the last octet are 11000000 = 192.',
        ja: '先頭の 24 ビットで 255.255.255、残り 2 ビットのネットワーク部は最後のオクテットの 11000000 = 192 になる。',
      },
    },
    {
      id: 'network-of-130',
      prompt: {
        en: 'Which network does 192.168.1.130/26 belong to?',
        ja: '192.168.1.130/26 が属するネットワークはどれ？',
      },
      choices: [
        { id: '192.168.1.128', text: { en: '192.168.1.128/26', ja: '192.168.1.128/26' } },
        { id: '192.168.1.0', text: { en: '192.168.1.0/26', ja: '192.168.1.0/26' } },
        { id: '192.168.1.64', text: { en: '192.168.1.64/26', ja: '192.168.1.64/26' } },
        { id: '192.168.1.130', text: { en: '192.168.1.130/26', ja: '192.168.1.130/26' } },
      ],
      answerId: '192.168.1.128',
      explanation: {
        en: 'A /26 splits the last octet into blocks of 64: 0, 64, 128, and 192. 130 falls in the block that starts at 128 (130 AND 192 = 128).',
        ja: '/26 は最後のオクテットを 64 ずつ（0、64、128、192）に分ける。130 は 128 から始まる区切りに入る（130 AND 192 = 128）。',
      },
    },
    {
      id: 'hosts-of-24',
      prompt: {
        en: 'How many hosts can be given an address in a /24 subnet?',
        ja: '/24 のサブネットで、ホストに割り当てられるアドレスはいくつ？',
      },
      choices: [
        { id: '256', text: { en: '256', ja: '256' } },
        { id: '255', text: { en: '255', ja: '255' } },
        { id: '128', text: { en: '128', ja: '128' } },
        { id: '254', text: { en: '254', ja: '254' } },
      ],
      answerId: '254',
      explanation: {
        en: 'A /24 has 2^8 = 256 addresses. The network address and the broadcast address cannot be given to hosts, which leaves 254.',
        ja: '/24 には 2^8 = 256 個のアドレスがある。ネットワークアドレスとブロードキャストアドレスはホストに割り当てられないので、254 になる。',
      },
    },
    {
      id: 'slash-31',
      prompt: {
        en: 'How is a /31 used on a point-to-point link between two routers?',
        ja: 'ルーターどうしのポイントツーポイントリンクでは、/31 をどう使う？',
      },
      choices: [
        {
          id: 'zero',
          text: {
            en: 'It cannot be used: no addresses are left for hosts',
            ja: '使えない（ホストに割り当てられるアドレスが残らない）',
          },
        },
        {
          id: 'both',
          text: {
            en: 'Both of its two addresses are used for the two ends',
            ja: '2 つのアドレスを両方とも両端に使う',
          },
        },
        {
          id: 'one',
          text: {
            en: 'Only one address is used; the other is the broadcast address',
            ja: '1 つだけを使い、もう 1 つはブロードキャストアドレスにする',
          },
        },
      ],
      answerId: 'both',
      explanation: {
        en: 'RFC 3021 allows /31 prefixes on point-to-point links. With only two ends, no network or broadcast address is needed, so both addresses are used.',
        ja: 'RFC 3021 は、ポイントツーポイントリンクで /31 を使うことを認めている。両端の 2 台しかいないので、ネットワークアドレスもブロードキャストアドレスも要らず、2 つとも使える。',
      },
    },
    {
      id: 'private',
      prompt: {
        en: 'Which address is a private address (RFC 1918)?',
        ja: 'プライベートアドレス（RFC 1918）はどれ？',
      },
      choices: [
        { id: '172.32.0.1', text: { en: '172.32.0.1', ja: '172.32.0.1' } },
        { id: '172.20.0.1', text: { en: '172.20.0.1', ja: '172.20.0.1' } },
        { id: '192.169.0.1', text: { en: '192.169.0.1', ja: '192.169.0.1' } },
        { id: '11.0.0.1', text: { en: '11.0.0.1', ja: '11.0.0.1' } },
      ],
      answerId: '172.20.0.1',
      explanation: {
        en: 'The private ranges are 10.0.0.0/8, 172.16.0.0/12 (172.16.0.0 to 172.31.255.255), and 192.168.0.0/16. 172.20.0.1 is inside 172.16.0.0/12.',
        ja: 'プライベートアドレスの範囲は 10.0.0.0/8、172.16.0.0/12（172.16.0.0〜172.31.255.255）、192.168.0.0/16。172.20.0.1 は 172.16.0.0/12 に入る。',
      },
    },
  ],
}
