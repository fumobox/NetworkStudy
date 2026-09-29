import type { Quiz } from '@/components/features/quiz/types'

/** VXLAN の理解度クイズ（根拠: RFC 7348 §4、§4.1、§4.3、§5、RFC 2992） */
export const vxlanQuiz: Quiz = {
  id: 'vxlan',
  questions: [
    {
      id: 'mtu',
      prompt: {
        en: 'The underlay MTU is 1500 and the outer header is IPv4. What is the largest inner IP packet VXLAN can carry without fragmentation?',
        ja: 'アンダーレイの MTU は 1500 で、外側のヘッダーは IPv4。VXLAN が断片化せずに運べる、内側の IP パケットの最大の長さは？',
      },
      choices: [
        { id: '1500', text: { en: '1500 bytes', ja: '1500 バイト' } },
        { id: '1450', text: { en: '1450 bytes', ja: '1450 バイト' } },
        { id: '1492', text: { en: '1492 bytes', ja: '1492 バイト' } },
      ],
      answerId: '1450',
      explanation: {
        en: 'VXLAN adds 50 bytes around the inner IP packet: the inner Ethernet header (14), the VXLAN header (8), UDP (8) and the outer IPv4 header (20). 1500 − 50 = 1450. 1492 is the MTU of PPPoE.',
        ja: 'VXLAN は内側の IP パケットの周りに 50 バイトを足す。内側の Ethernet のヘッダー（14）、VXLAN のヘッダー（8）、UDP（8）、外側の IPv4 のヘッダー（20）。1500 − 50 = 1450。1492 は PPPoE の MTU。',
      },
    },
    {
      id: 'learn',
      prompt: {
        en: 'VTEP 2 receives a VXLAN packet from 192.0.2.10 with VNI 100. The inner frame’s source MAC address is 00:00:5e:00:53:01. What does VTEP 2 learn?',
        ja: 'VTEP 2 が、192.0.2.10 から VNI 100 の VXLAN のパケットを受け取る。内側のフレームの送信元の MAC アドレスは 00:00:5e:00:53:01。VTEP 2 は何を学習する？',
      },
      choices: [
        {
          id: 'mac-behind-vtep',
          text: {
            en: 'In VNI 100, 00:00:5e:00:53:01 is behind 192.0.2.10',
            ja: 'VNI 100 では、00:00:5e:00:53:01 は 192.0.2.10 の先にいる',
          },
        },
        {
          id: 'arp',
          text: {
            en: 'The inner IP address belongs to 192.0.2.10',
            ja: '内側の IP アドレスは 192.0.2.10 のもの',
          },
        },
        {
          id: 'nothing',
          text: {
            en: 'Nothing: VTEPs learn only from ARP replies',
            ja: '何も学習しない。VTEP は ARP の応答からしか学習しない',
          },
        },
      ],
      answerId: 'mac-behind-vtep',
      explanation: {
        en: 'RFC 7348 §4.1: the VTEP records the inner source MAC address together with the outer source IP address, per VNI. It learns from any frame, not only ARP. Next time it sends a frame for that MAC address straight to 192.0.2.10, without flooding.',
        ja: 'RFC 7348 §4.1。VTEP は、内側の送信元の MAC アドレスと外側の送信元の IP アドレスの対応を、VNI ごとに記録する。ARP だけでなく、どのフレームからも学習する。次からは、その MAC アドレス宛てのフレームを流さずに 192.0.2.10 へ直接送る。',
      },
    },
    {
      id: 'tenants',
      prompt: {
        en: 'Two tenants use the same subnet, 10.0.0.0/24: red on VNI 100 and blue on VNI 200. A red container sends an ARP request for 10.0.0.2. Who receives it?',
        ja: '2 つのテナントが同じサブネット 10.0.0.0/24 を使う。赤は VNI 100、青は VNI 200。赤のコンテナーが 10.0.0.2 の ARP の要求を送る。誰が受け取る？',
      },
      choices: [
        {
          id: 'both',
          text: { en: 'Every 10.0.0.2, in both tenants', ja: '両方のテナントのすべての 10.0.0.2' },
        },
        {
          id: 'none',
          text: {
            en: 'Nobody: the VTEP drops overlapping subnets',
            ja: '誰も受け取らない。VTEP は重なるサブネットを捨てる',
          },
        },
        {
          id: 'red',
          text: { en: 'Only the containers in VNI 100', ja: 'VNI 100 のコンテナーだけ' },
        },
      ],
      answerId: 'red',
      explanation: {
        en: 'Each VNI is its own Layer 2 segment (RFC 7348 §4). The VTEP floods the broadcast only to the ports and remote VTEPs of VNI 100, and the receiving VTEP delivers it only to the ports of VNI 100. The same addresses can be reused in another VNI without any conflict.',
        ja: 'VNI ごとに別の L2 のセグメントになる（RFC 7348 §4）。VTEP はブロードキャストを VNI 100 のポートと相手の VTEP にだけ流し、受け取った VTEP も VNI 100 のポートにだけ渡す。別の VNI では、同じアドレスをぶつからずに使える。',
      },
    },
    {
      id: 'entropy',
      prompt: {
        en: 'Why does the outer UDP source port differ from one inner flow to another, while the destination port stays 4789?',
        ja: '外側の UDP の送信元ポートが内側の流れごとに違い、宛先ポートは 4789 のままなのはなぜ？',
      },
      choices: [
        {
          id: 'tenant',
          text: {
            en: 'So that the receiving VTEP can tell tenants apart',
            ja: '受け取った VTEP がテナントを見分けられるように',
          },
        },
        {
          id: 'ecmp',
          text: {
            en: 'So that routers hashing the outer headers spread flows over equal-cost paths',
            ja: '外側のヘッダーをハッシュするルーターが、流れを等コストの経路に散らせるように',
          },
        },
        {
          id: 'nat',
          text: {
            en: 'Because a NAT between the hosts needs a new port for each packet',
            ja: 'ホストの間の NAT が、パケットごとに新しいポートを要るから',
          },
        },
      ],
      answerId: 'ecmp',
      explanation: {
        en: 'All VXLAN packets between two hosts have the same outer addresses and destination port. RFC 7348 §5 recommends deriving the source port from a hash of the inner packet, so that routers that hash the outer headers (ECMP) spread different flows over different paths, while each flow keeps one path and stays in order. Tenants are told apart by the VNI.',
        ja: '2 台のホストの間の VXLAN のパケットは、どれも外側のアドレスと宛先ポートが同じ。RFC 7348 §5 は、送信元ポートを内側のパケットのハッシュから作ることを勧める。外側のヘッダーをハッシュするルーター（ECMP）が別々の流れを別々の経路に散らし、1 つの流れは 1 つの経路にとどまって順序を保つ。テナントを見分けるのは VNI。',
      },
    },
  ],
}
