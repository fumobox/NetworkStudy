import type { Quiz } from '@/components/features/quiz/types'

/** NAT 越えの理解度クイズ（根拠は scenario.ts の RFC 8489・RFC 8656・RFC 8445・RFC 4787 の参照と同じ） */
export const natTraversalQuiz: Quiz = {
  id: 'nat-traversal',
  questions: [
    {
      id: 'xor',
      prompt: {
        en: 'Why does the STUN server XOR the address it reports with the magic cookie?',
        ja: 'STUN のサーバーが、知らせるアドレスをマジッククッキーと XOR するのはなぜ？',
      },
      choices: [
        {
          id: 'encrypt',
          text: {
            en: 'To encrypt it so that eavesdroppers cannot read it',
            ja: '盗み聞きされないよう暗号化するため',
          },
        },
        {
          id: 'shorter',
          text: { en: 'To make the message shorter', ja: 'メッセージを短くするため' },
        },
        {
          id: 'alg',
          text: {
            en: 'So that NATs that rewrite copies of their public address inside packets leave it alone',
            ja: 'パケットの中にある自分のグローバルアドレスの写しまで書き換える NAT に、触られないようにするため',
          },
        },
      ],
      answerId: 'alg',
      explanation: {
        en: 'Some NATs with an application-level gateway rewrite any 4 bytes that look like their own public address, which broke the original MAPPED-ADDRESS. XOR with a public constant is not encryption: anyone can undo it.',
        ja: 'アプリケーション層のゲートウェイ（ALG）を持つ NAT の中には、自分のグローバルアドレスに見える 4 バイトを何でも書き換えるものがあり、元の MAPPED-ADDRESS を壊していた。公開された定数との XOR は暗号化ではなく、誰でも元に戻せる。',
      },
    },
    {
      id: 'holepunch',
      prompt: {
        en: 'PC A’s first check is dropped at NAT B, but soon the direct path works. What changed?',
        ja: 'PC A の最初のチェックは NAT B で捨てられたが、すぐに直接の経路が通るようになった。何が変わった？',
      },
      choices: [
        {
          id: 'turn',
          text: {
            en: 'The TURN server told NAT B to open a port',
            ja: 'TURN のサーバーが NAT B にポートを開けさせた',
          },
        },
        {
          id: 'both',
          text: {
            en: 'PC B sent its own check to 203.0.113.5:40001, so NAT B now lets packets from that address in',
            ja: 'PC B が 203.0.113.5:40001 に自分のチェックを送ったので、NAT B がそのアドレスからのパケットを通すようになった',
          },
        },
        {
          id: 'new-port',
          text: {
            en: 'NAT B deleted its mapping and made a new port',
            ja: 'NAT B が対応を消し、新しいポートを作った',
          },
        },
      ],
      answerId: 'both',
      explanation: {
        en: 'A NAT that filters by address and port lets in only packets from addresses it has sent to. Once both sides have sent to each other’s public address, both NATs let the traffic through: hole punching. Neither the STUN nor the TURN server can open a port on someone else’s NAT.',
        ja: 'アドレスとポートでフィルタリングする NAT は、送ったことのある相手からのパケットしか通さない。両側が相手のグローバルアドレスに送れば、両方の NAT が通す。これがホールパンチング。STUN や TURN のサーバーが、ほかの NAT のポートを開けさせることはできない。',
      },
    },
    {
      id: 'permission',
      prompt: {
        en: 'PC A created a TURN permission for 192.0.2.77. A packet arrives at the relayed address from 192.0.2.77:60003, a port nobody told the server about. What does the server do?',
        ja: 'PC A は 192.0.2.77 の TURN の許可を作った。中継のアドレスに、誰もサーバーに知らせていないポート 192.0.2.77:60003 からパケットが届いた。サーバーはどうする？',
      },
      choices: [
        {
          id: 'relay',
          text: {
            en: 'It relays it: permissions compare only the IP address',
            ja: '中継する。許可は IP アドレスだけを比べる',
          },
        },
        {
          id: 'drop',
          text: {
            en: 'It drops it because the port is different',
            ja: 'ポートが違うので捨てる',
          },
        },
        {
          id: 'auth',
          text: {
            en: 'It answers 401 to make PC B authenticate',
            ja: '401 で答え、PC B に認証させる',
          },
        },
      ],
      answerId: 'relay',
      explanation: {
        en: 'A permission is for an IP address, whatever the port. That is what lets PC B’s new port 60003, opened by its “symmetric” NAT, reach PC A. Peers never talk TURN, so they are never asked to authenticate.',
        ja: '許可はポートにかかわらず、IP アドレスに対するもの。だから、いわゆるシンメトリック NAT が開けた PC B の新しいポート 60003 からも、PC A に届く。相手は TURN を話さないので、認証を求められることはない。',
      },
    },
    {
      id: 'refresh',
      prompt: {
        en: 'PC A sends Refresh on time, yet after 5 minutes PC B’s packets are dropped at the server. Why?',
        ja: 'PC A は期限までに Refresh を送ったのに、5 分後、PC B のパケットがサーバーで捨てられた。なぜ？',
      },
      choices: [
        {
          id: 'max',
          text: {
            en: 'An allocation cannot be extended beyond 600 seconds',
            ja: '割り当ては 600 秒より長く延ばせないから',
          },
        },
        {
          id: 'integrity',
          text: {
            en: 'ChannelData needs MESSAGE-INTEGRITY',
            ja: 'ChannelData に MESSAGE-INTEGRITY が要るから',
          },
        },
        {
          id: 'permission',
          text: {
            en: 'Refresh extends only the allocation; the 300-second permission must be refreshed with CreatePermission or ChannelBind',
            ja: 'Refresh が延ばすのは割り当てだけで、300 秒の許可は CreatePermission か ChannelBind で更新しなければならないから',
          },
        },
      ],
      answerId: 'permission',
      explanation: {
        en: 'Allocations, permissions and channels each have their own timer. Sending data refreshes none of them, and Refresh extends only the allocation. Permissions last 300 seconds, so they need refreshing more often than anything else.',
        ja: '割り当て、許可、チャネルは、それぞれ自分のタイマーを持つ。データを送っても、どれも更新されない。Refresh が延ばすのは割り当てだけ。許可は 300 秒なので、ほかのどれよりも頻繁に更新しなければならない。',
      },
    },
  ],
}
