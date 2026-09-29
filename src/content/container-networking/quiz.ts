import type { Quiz } from '@/components/features/quiz/types'

/**
 * コンテナーのネットワークの理解度クイズ（根拠: RFC 826、RFC 1122 §3.3.1、RFC 3022 §2.2、IEEE Std 802.1Q-2022 clause 8.6、
 * nftables wiki の NAT、Docker のドキュメント「Networking overview」「Bridge network driver」「Port publishing and mapping」、Engine 28 のリリースノート）
 */
export const containerNetworkingQuiz: Quiz = {
  id: 'container-networking',
  questions: [
    {
      id: 'source',
      prompt: {
        en: 'A container at 172.17.0.2 on Docker’s default bridge connects to a web server on the Internet. The host’s address is 198.51.100.10. Which source address does the web server see?',
        ja: 'Docker の既定のブリッジの上の 172.17.0.2 のコンテナーが、インターネットの Web サーバーに接続する。ホストのアドレスは 198.51.100.10。Web サーバーに見える送信元のアドレスは？',
      },
      choices: [
        { id: 'container', text: { en: '172.17.0.2', ja: '172.17.0.2' } },
        { id: 'host', text: { en: '198.51.100.10', ja: '198.51.100.10' } },
        { id: 'bridge', text: { en: '172.17.0.1', ja: '172.17.0.1' } },
      ],
      answerId: 'host',
      explanation: {
        en: 'The host masquerades the packet: it rewrites the source to the address of the interface the packet leaves by. Connection tracking remembers the connection and changes the destination of the reply back to 172.17.0.2, so the container never notices.',
        ja: 'ホストはパケットをマスカレードする。送信元を、パケットが出ていくインターフェースのアドレスに書き換える。接続の追跡がこの接続を覚えていて、返事の宛先を 172.17.0.2 に戻すので、コンテナーは気づかない。',
      },
    },
    {
      id: 'arp',
      prompt: {
        en: 'The container at 172.17.0.2 sends its first packet to 203.0.113.80. Whose MAC address does it ask for with ARP?',
        ja: '172.17.0.2 のコンテナーが、203.0.113.80 に最初のパケットを送る。ARP で誰の MAC アドレスを尋ねる？',
      },
      choices: [
        {
          id: 'gateway',
          text: {
            en: '172.17.0.1, the bridge’s own address in the host',
            ja: 'ホストの中のブリッジ自身のアドレス 172.17.0.1',
          },
        },
        {
          id: 'destination',
          text: {
            en: '203.0.113.80, the destination of the packet',
            ja: 'パケットの宛先の 203.0.113.80',
          },
        },
        {
          id: 'none',
          text: {
            en: 'Nobody: a veth pair does not need MAC addresses',
            ja: '誰にも尋ねない。veth ペアに MAC アドレスは要らない',
          },
        },
      ],
      answerId: 'gateway',
      explanation: {
        en: '203.0.113.80 is not on the container’s network, so the packet goes to the default gateway, 172.17.0.1 (RFC 1122 §3.3.1). The container behaves like any host on a LAN: the veth pair is an Ethernet link, and the frame carries the gateway’s MAC address.',
        ja: '203.0.113.80 はコンテナーのネットワークにないので、パケットはデフォルトゲートウェイ 172.17.0.1 に送る（RFC 1122 §3.3.1）。コンテナーは LAN の上のほかのホストと同じようにふるまう。veth ペアは Ethernet のリンクで、フレームにはゲートウェイの MAC アドレスが入る。',
      },
    },
    {
      id: 'published',
      prompt: {
        en: 'A container was started with -p 8080:80. A client at 203.0.113.80 connects to the host’s port 8080. Which source address does the application in the container see?',
        ja: 'コンテナーは -p 8080:80 を付けて起動した。203.0.113.80 のクライアントがホストのポート 8080 に接続する。コンテナーの中のアプリケーションに見える送信元のアドレスは？',
      },
      choices: [
        { id: 'host', text: { en: '198.51.100.10 (the host)', ja: '198.51.100.10（ホスト）' } },
        { id: 'bridge', text: { en: '172.17.0.1 (the bridge)', ja: '172.17.0.1（ブリッジ）' } },
        {
          id: 'client',
          text: { en: '203.0.113.80 (the client)', ja: '203.0.113.80（クライアント）' },
        },
      ],
      answerId: 'client',
      explanation: {
        en: 'A published port is DNAT: the host changes only the destination, to 172.17.0.2:80. The source stays the real client, and the reply’s source is changed back to the host’s port 8080. Connections from the host itself may instead go through Docker’s docker-proxy process, which can hide the client’s address.',
        ja: 'ポートの公開は DNAT。ホストが変えるのは宛先（172.17.0.2:80）だけで、送信元は本当のクライアントのまま。返事の送信元は、ホストのポート 8080 に戻される。ホスト自身からの接続は、Docker の docker-proxy のプロセスを通ることがあり、そのときはクライアントのアドレスが見えなくなりうる。',
      },
    },
    {
      id: 'same-bridge',
      prompt: {
        en: 'Container A (172.17.0.2) connects to port 80 of container B (172.17.0.3) on the same bridge. Which is true?',
        ja: '同じブリッジのコンテナー A（172.17.0.2）が、コンテナー B（172.17.0.3）のポート 80 に接続する。正しいのは？',
      },
      choices: [
        {
          id: 'bridged',
          text: {
            en: 'The bridge switches the frames; addresses and TTL stay the same',
            ja: 'ブリッジがフレームを転送するので、アドレスも TTL も変わらない',
          },
        },
        {
          id: 'masquerade',
          text: {
            en: 'The host masquerades A’s address, so B sees 198.51.100.10',
            ja: 'ホストが A のアドレスをマスカレードし、B には 198.51.100.10 が見える',
          },
        },
        {
          id: 'publish',
          text: {
            en: 'B must publish port 80 with -p first, or A cannot reach it',
            ja: 'B が先に -p でポート 80 を公開しないと、A は届かない',
          },
        },
      ],
      answerId: 'bridged',
      explanation: {
        en: 'B is on A’s own network, so A asks for B’s MAC address and the bridge forwards the frames between the two veth ports like a switch. Nothing is routed or translated. Publishing is only needed to reach a port from outside the host; containers on the same network can reach it anyway.',
        ja: 'B は A 自身のネットワークにいるので、A は B の MAC アドレスを尋ね、ブリッジはスイッチと同じように 2 つの veth のポートの間でフレームを転送する。経路の選択も変換もない。公開が要るのはホストの外からポートに届かせるときだけで、同じネットワークのコンテナーは公開しなくても届く。',
      },
    },
  ],
}
