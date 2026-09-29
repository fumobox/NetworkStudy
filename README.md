# NetworkStudy

An interactive portal for learning how network protocols work, one packet at a time.
ネットワークプロトコルの動きを、1 パケットずつ自分の手で進めて学ぶインタラクティブな学習サイトです。

## Learning paths / 学習の道筋

Not sure where to start? Follow a path: Web developers (14 themes) or Infrastructure and operations (19 themes).
どこから始めるか迷ったら、道筋に沿って読めます: Web エンジニア向け（14 テーマ）、インフラ運用向け（19 テーマ）。

## Topics / テーマ

Network basics / ネットワークの基礎

- The OSI model and encapsulation / OSI 参照モデルとカプセル化
- Subnet calculator / サブネット計算
- IPv6 addresses: notation and kinds / IPv6 アドレス: 表記と種類

Getting on the network / ネットワークにつながるまで

- ARP: from IP address to MAC address / ARP: IP アドレスから MAC アドレスへ
- DHCP: getting an IP address / DHCP: IP アドレスをもらう
- ICMP: ping and traceroute / ICMP: ping と traceroute
- Path MTU discovery: when a packet is too big / パス MTU 探索: パケットが大きすぎるとき
- NAT: sharing one public address / NAT: 1 つのグローバルアドレスを共有する
- NAT traversal: STUN, TURN and ICE / NAT 越え: STUN・TURN・ICE
- Route lookup: longest prefix match / 経路の検索: 最長一致

Inside the LAN / LAN の中

- Switching: how a switch learns MAC addresses / スイッチ: MAC アドレスを学習する
- VLAN: one switch, separate networks / VLAN: 1 台のスイッチを別々のネットワークに分ける
- Container networking: veth, bridge and NAT / コンテナーのネットワーク: veth、ブリッジ、NAT
- VXLAN: stretching a LAN over an IP network / VXLAN: IP ネットワークの上に LAN を延ばす
- Wi-Fi: joining a wireless network / Wi-Fi: 無線 LAN につながる
- IPv6 on the LAN: SLAAC and Neighbor Discovery / IPv6 で LAN につながる: SLAAC と近隣探索

How a web page reaches you / Web のページが届くまで

- DNS name resolution / DNS の名前解決
- TCP three-way handshake / TCP 3 ウェイハンドシェイク
- TLS 1.3 handshake and certificates / TLS 1.3 のハンドシェイクと証明書
- HTTPS from start to finish / HTTPS の全体像

More about TCP / TCP をもっと詳しく

- Closing a TCP connection / TCP の接続の終了
- TCP congestion control / TCP の輻輳制御
- TCP flow control: the receive window / TCP のフロー制御: 受信ウィンドウ
- Fast retransmit and SACK: resending only what was lost / 高速再送と SACK: 失われた分だけを再送する

HTTP for web developers / Web 開発で出会う HTTP

- HTTP caching: Cache-Control and ETag / HTTP のキャッシュ: Cache-Control と ETag
- CORS: cross-origin requests and preflight / CORS: オリジンをまたぐ要求とプリフライト
- HTTP/1.1 vs HTTP/2: many requests on one connection / HTTP/1.1 と HTTP/2: 1 つの接続でたくさんの要求
- QUIC and HTTP/3: handshake, 0-RTT, and loss / QUIC と HTTP/3: ハンドシェイク、0-RTT、ロス
- WebSocket: handshake, frames, and closing / WebSocket: ハンドシェイク、フレーム、接続の終了
- Server-Sent Events: a response that never ends, and reconnecting on its own / Server-Sent Events: 終わらない応答と自動の再接続
- Reverse proxies and load balancers / リバースプロキシとロードバランサー

Network security / ネットワークのセキュリティ

- Stateful firewall: letting replies in, keeping strangers out / ステートフルファイアウォール: 返事は通し、見知らぬ相手は止める
- WireGuard: a remote-access VPN built on public keys / WireGuard: 公開鍵で結ぶリモートアクセス VPN
- DNSSEC: a chain of trust for DNS answers / DNSSEC: DNS の答えをたどる信頼の連鎖
- Email authentication: SPF, DKIM and DMARC / メールの送信ドメイン認証: SPF、DKIM、DMARC
- HSTS and SSL stripping / HSTS と SSL ストリッピング
- Cookies and CSRF: SameSite, tokens and Fetch Metadata / Cookie と CSRF: SameSite、トークン、Fetch Metadata

Available in English and Japanese. / 英語・日本語に対応しています。

## Site / サイト

https://fumobox.github.io/NetworkStudy/

The plan and roadmap are in [docs/PLAN.md](docs/PLAN.md). / 計画とロードマップは [docs/PLAN.md](docs/PLAN.md) にあります。

## License

[MIT](LICENSE)
