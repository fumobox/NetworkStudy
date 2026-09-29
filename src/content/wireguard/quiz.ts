import type { Quiz } from '@/components/features/quiz/types'

/** WireGuard の理解度クイズ（根拠: ホワイトペーパー §2、§2.1、§5.4.6、§6、wg(8)、Linux の drivers/net/wireguard/device.c） */
export const wireguardQuiz: Quiz = {
  id: 'wireguard',
  questions: [
    {
      id: 'inbound-source',
      prompt: {
        en: 'The server’s peers are the laptop (AllowedIPs 10.8.0.2/32) and a phone (10.8.0.3/32). A correctly authenticated packet from the laptop has the inner source 10.8.0.3. What does the server do?',
        ja: 'サーバーのピアは、ノート PC（AllowedIPs 10.8.0.2/32）とスマートフォン（10.8.0.3/32）。ノート PC から、正しく認証できるパケットが届いた。内側の送信元は 10.8.0.3。サーバーはどうする？',
      },
      choices: [
        {
          id: 'deliver',
          text: {
            en: 'Delivers it: the packet was authenticated',
            ja: '届ける。パケットは認証できた',
          },
        },
        {
          id: 'drop',
          text: {
            en: 'Drops it: 10.8.0.3 belongs to another peer',
            ja: '捨てる。10.8.0.3 はほかのピアのもの',
          },
        },
        {
          id: 'rekey',
          text: {
            en: 'Starts a new handshake with the laptop',
            ja: 'ノート PC と新しいハンドシェイクを始める',
          },
        },
      ],
      answerId: 'drop',
      explanation: {
        en: 'Cryptokey routing checks both ways. After decrypting, the server looks up the inner source in AllowedIPs, and the result must be the peer that sent the packet. 10.8.0.3 belongs to the phone, so the packet is dropped: each peer can only speak for its own addresses.',
        ja: '暗号鍵ルーティングは両方の向きで確かめる。復号した後、サーバーは内側の送信元を AllowedIPs で引き、その結果が送ってきたピアでなければならない。10.8.0.3 はスマートフォンのものなので、捨てる。どのピアも、自分のアドレスの分しか名乗れない。',
      },
    },
    {
      id: 'roaming',
      prompt: {
        en: 'In the middle of a session, the laptop moves from home Wi-Fi to a café and gets a new address. What does the server need?',
        ja: 'セッションの途中で、ノート PC が家の Wi-Fi からカフェに移り、新しいアドレスを得る。サーバーには何が要る？',
      },
      choices: [
        {
          id: 'nothing',
          text: {
            en: 'Nothing: the next authenticated packet updates the endpoint',
            ja: '何も要らない。次に認証できたパケットでエンドポイントが変わる',
          },
        },
        {
          id: 'handshake',
          text: {
            en: 'A new handshake, because the keys depend on the address',
            ja: '新しいハンドシェイク。鍵はアドレスに結びついているから',
          },
        },
        {
          id: 'config',
          text: {
            en: 'An administrator must change the laptop’s Endpoint by hand',
            ja: '管理者がノート PC の Endpoint を手で書き換える',
          },
        },
      ],
      answerId: 'nothing',
      explanation: {
        en: 'Keys belong to public keys, not to addresses. When the server receives a correctly authenticated packet from the laptop, it takes that packet’s source address and port as the new endpoint (wg(8)). The laptop, the side that moved, just has to send first.',
        ja: '鍵は公開鍵に結びつき、アドレスには結びつかない。サーバーはノート PC から正しく認証できるパケットを受け取ると、その送信元のアドレスとポートを新しいエンドポイントにする（wg(8)）。移った側のノート PC が、先に送ればよい。',
      },
    },
    {
      id: 'keepalive',
      prompt: {
        en: 'A laptop behind a NAT is idle. After a while, the office can no longer reach it through the tunnel, although it can still reach the office. Which setting fixes this?',
        ja: 'NAT の内側のノート PC が黙っている。しばらくすると、ノート PC からオフィスには届くのに、オフィスからトンネルでノート PC に届かなくなる。どの設定で直る？',
      },
      choices: [
        {
          id: 'mtu',
          text: { en: 'MTU = 1280 on wg0 on both sides', ja: '両側の wg0 の MTU = 1280' },
        },
        {
          id: 'port',
          text: {
            en: 'ListenPort = 51820 on the laptop’s wg0',
            ja: 'ノート PC の wg0 の ListenPort = 51820',
          },
        },
        {
          id: 'persistent',
          text: {
            en: 'PersistentKeepalive = 25 on the laptop',
            ja: 'ノート PC の PersistentKeepalive = 25',
          },
        },
      ],
      answerId: 'persistent',
      explanation: {
        en: 'The NAT forgets an idle UDP mapping, and then drops packets from the server. PersistentKeepalive makes the laptop send a small keepalive every 25 seconds of silence, which keeps the mapping alive. It is off by default, and only needed when the peer behind the NAT must be reachable while idle.',
        ja: 'NAT は使われない UDP の対応を忘れ、その後はサーバーからのパケットを捨てる。PersistentKeepalive を設定すると、ノート PC は 25 秒黙るたびに小さなキープアライブを送り、対応を保つ。既定では使わず、NAT の内側のピアに黙っているあいだも届く必要があるときだけ要る。',
      },
    },
    {
      id: 'mtu',
      prompt: {
        en: 'Linux gives a new WireGuard interface MTU 1420 by default. Where do the missing 80 bytes go?',
        ja: 'Linux は新しい WireGuard のインターフェースに、既定で MTU 1420 を設定する。足りない 80 バイトは何に使う？',
      },
      choices: [
        {
          id: 'ipv4',
          text: {
            en: 'An IPv4 header (20) and 60 bytes of encryption',
            ja: 'IPv4 のヘッダー（20）と、暗号化の 60 バイト',
          },
        },
        {
          id: 'ipv6',
          text: {
            en: 'WireGuard (32), UDP (8) and an IPv6 header (40)',
            ja: 'WireGuard（32）、UDP（8）、IPv6 のヘッダー（40）',
          },
        },
        {
          id: 'cookie',
          text: {
            en: 'A cookie (64) and the tag (16)',
            ja: 'cookie（64）とタグ（16）',
          },
        },
      ],
      answerId: 'ipv6',
      explanation: {
        en: 'A data message adds 32 bytes: a 16-byte header (type, receiver index, counter) and a 16-byte authentication tag. Then come UDP (8) and the outer IP header. Linux subtracts 80 so that the tunnel fits even over IPv6 (40); over IPv4 (20) the overhead is 60. Padding to a multiple of 16 can add up to 15 bytes, but never past the MTU.',
        ja: 'データのメッセージは 32 バイトを足す。16 バイトのヘッダー（種類、受け取る側のインデックス、カウンター）と、16 バイトの認証のタグ。その外に UDP（8）と外側の IP のヘッダー。Linux は、外側が IPv6（40）でも収まるよう 80 を引く。IPv4（20）ならオーバーヘッドは 60。16 の倍数への詰め物で最大 15 バイト増えるが、MTU は超えない。',
      },
    },
  ],
}
