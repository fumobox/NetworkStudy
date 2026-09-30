# 用語集

サイトに表示する文章（シナリオ、クイズ、概要の MDX、UI の辞書、テーマのメタ情報）の訳語と表記をそろえるための一覧。コードのコメントや開発者向けのドキュメントは対象外。

新しいテーマを書くときや文言を変えるときは、この用語集に従う。載っていない用語を使うときは、ここに追記する。機械的に確かめられる規則は `src/content/glossary.test.tsx` で検査している。

## 1. 表記の規則

| 規則 | 例 | テストで検査 |
|---|---|---|
| 英語の語末 -er / -or / -ar は長音「ー」を付ける | サーバー、リゾルバー、ブラウザー、タイマー、ヘッダー、ルーター、ユーザー、コンピューター | ○（下の表の語） |
| 日本語（かな・漢字）と半角英数字の間には半角スペースを入れる。句読点・括弧・「・」の前後には入れない | `TCP の接続`、`3 ウェイハンドシェイク`、`「SYN」を送る`、`NXDOMAIN・CNAME` | ○ |
| 英数字は半角にする（全角英数字を使わない） | `SYN`（`ＳＹＮ` としない） | ○ |
| 日本語の文中の括弧は全角「（）」にする。式やコードの括弧は半角のまま | `TTL（有効期限）`、`min(SOA の TTL, SOA の MINIMUM)` | × |
| シナリオ・クイズ・概要、ホームの説明文の文末は常体（だ・である）か体言止めにする。UI の操作への案内やメッセージ（空の状態、エラーなど）は敬体（です・ます）にする | 「ポートが閉じている」／「まだ表示するメッセージはありません。」 | × |
| 強調（`**…**`）は全角の記号の直後で閉じない（CommonMark の規則で太字にならない）。記号は強調の外に出す | `**紹介**（委任）` | ○（`overview.test.tsx`） |

## 2. 翻訳しない用語

プロトコルの仕様に出てくる名前は、訳さずに原文のまま書く（コードでは `ProtocolTerm` 型）。必要なら初出で日本語の説明を添える（例: 「SYN（接続の開始を求めるセグメント）」）。

| 分野 | 用語 |
|---|---|
| TCP のフラグ・セグメント | SYN、ACK、SYN, ACK、RST、RST, ACK、FIN |
| TCP の状態 | CLOSED、LISTEN、SYN-SENT、SYN-RECEIVED、ESTABLISHED、FIN-WAIT-1、FIN-WAIT-2、CLOSE-WAIT、CLOSING、LAST-ACK、TIME-WAIT |
| TCP の再送 | SACK、SACK-Permitted、DupThresh、NewReno、RACK、TLP、IsLost、in flight、ACKed、SACKed、retransmitted |
| TCP の変数・パラメーター | ISS、IRS、SND.NXT、RCV.NXT、MSS、RTO、RTT、MSL、cwnd、ssthresh、SND.UNA、SND.WND、RCV.WND、RCV.BUFF、win、Window probe、persist、Window Scale、SWS、Nagle |
| DNS のメッセージ・フィールド | QNAME、QTYPE、ID、QR、RD、RA、AA、RCODE、NOERROR、NXDOMAIN、SERVFAIL、TTL |
| DNS のレコード | A、AAAA、NS、CNAME、SOA、MX |
| DNSSEC | DNSSEC、DNSKEY、DS、RRSIG、NSEC、NSEC3、Opt-Out、KSK、ZSK、SEP、key tag、DO、AD、CD、EDNS0、OPT、RRset、Secure、Insecure、Bogus、Indeterminate、ECDSAP256SHA256、RSASHA256、SHA-256、DoT、DoH |
| TLS 1.3 のメッセージ | ClientHello、ServerHello、EncryptedExtensions、Certificate、CertificateVerify、Finished、Alert |
| TLS の拡張・値 | key_share、supported_versions、signature_algorithms、server_name（SNI）、certificate_expired、certificate_unknown、unknown_ca |
| 証明書 | SAN（subjectAltName）、CA、X.509 |
| その他 | IP、IPv4、HTTP、HTTPS、URL、RFC、OSI、CIDR、Ethernet、Wi-Fi、MAC、FCS、UDP、UTF-8 |
| ARP | ARP、who-has、is-at、HTYPE、PTYPE、HLEN、PLEN、OPER、SHA、SPA、THA、TPA、EtherType、LAN |
| スイッチ | Ingress port、Egress port、learn、flood、forward、refresh、aged out、accepted、dropped (not my MAC)、ignored (not the target)、STP |
| VLAN | VLAN、802.1Q、TPID、TCI、PCP（Priority Code Point）、DEI、VID、PVID、access、trunk、eth0.10（サブインターフェースの名前）、on-link、gateway |
| ICMP | ICMP、ping、traceroute、tracert、Echo Request、Echo Reply、Time Exceeded、Destination Unreachable、network unreachable、host unreachable、port unreachable、type / code、TTL |
| 近隣探索 | NDP、ICMPv6、RS、RA、NS、NA、DAD、SLAAC、DHCPv6、MLD、RDNSS、RetransTimer、RTR_SOLICITATION_INTERVAL、MAX_RTR_SOLICITATION_DELAY、Neighbor Solicitation、Neighbor Advertisement、Router Solicitation、Router Advertisement、Cur Hop Limit、Router Lifetime、Prefix Information、M / O / L / A / R / S フラグ、tentative、preferred、duplicate、INCOMPLETE、REACHABLE、STALE、DELAY、PROBE、NUD |
| パス MTU 探索 | MTU、PMTU、DF（Don’t Fragment）、MF（More Fragments）、Identification、Fragment offset、Total length、Fragmentation Needed、Next-Hop MTU、Packet Too Big、PPPoE、PLPMTUD、MSS clamping |
| NAT | NAT、NAPT、ALG、UPnP、PCP |
| NAT 越え（STUN・TURN・ICE） | STUN、TURN、ICE、WebRTC、SDP、Trickle ICE、coturn、turns:、Binding Request、Binding Success Response、Allocate、Refresh、CreatePermission、ChannelBind、Send indication、Data indication、ChannelData、XOR-MAPPED-ADDRESS、XOR-RELAYED-ADDRESS、XOR-PEER-ADDRESS、REQUESTED-TRANSPORT、LIFETIME、CHANNEL-NUMBER、DATA、USERNAME、REALM、NONCE、MESSAGE-INTEGRITY、MESSAGE-INTEGRITY-SHA256、PASSWORD-ALGORITHMS、PASSWORD-ALGORITHM、FINGERPRINT、ERROR-CODE、PRIORITY、USE-CANDIDATE、ICE-CONTROLLING、ICE-CONTROLLED、Message Type、Message Length、Magic Cookie、Transaction ID、X-Port、X-Address、401 Unauthenticated、host、srflx、prflx、relay、ice-ufrag、ice-pwd、a=candidate、typ、raddr、rport、Waiting、In-Progress、Succeeded、Failed、Running、Completed、controlling、controlled、EIM、APDM、APDF、SRTP、DTLS、consent freshness（状態の値 UDP blocked, TCP 80/443、Succeeded, nominated、フィールド名 IP Src → Dst、Transport、Translation、Payload、Padding、ChannelData header と、表の列 Type、Address、Priority、Local、Remote、State、Field、Value、Peer IP、Expires in、Channel、Peer、5-tuple、Relayed、Lifetime、Username も翻訳しない） |
| ファイアウォール | NEW、ESTABLISHED、RELATED、INVALID、UNREPLIED、REPLIED、accept、drop、reject、conntrack、ct state、5-tuple、filtered、closed（ポートスキャンの結果）、Port Unreachable、communication administratively prohibited、connection refused、SSH |
| IPv6 アドレス | IPv6、EUI-64、U/L ビット、ff:fe、RFC 5952 |
| DHCP | DHCP、DHCPDISCOVER、DHCPOFFER、DHCPREQUEST、DHCPACK、DHCPNAK、DHCPDECLINE、DHCPRELEASE、DHCPINFORM、DORA、xid、secs、flags、ciaddr、yiaddr、siaddr、giaddr、chaddr、INIT、SELECTING、REQUESTING、BOUND、RENEWING、REBINDING、INIT-REBOOT、REBOOTING、T1、T2 |
| HTTP のキャッシュ | Cache-Control、max-age、no-cache、no-store、s-maxage、Vary、ETag、If-None-Match、Last-Modified、If-Modified-Since、Expires、Age、Date、200 OK、304 Not Modified、GET、fresh、stale、hit、miss |
| CORS | CORS、Origin、Access-Control-Allow-Origin、Access-Control-Allow-Credentials、Access-Control-Allow-Methods、Access-Control-Allow-Headers、Access-Control-Request-Method、Access-Control-Request-Headers、Access-Control-Max-Age、OPTIONS、POST、204 No Content、201 Created、fetch()、TypeError、credentials: include、preflight required、no preflight required、Cookie、CSRF、Access-Control-Expose-Headers、Private Network Access |
| HTTP/2 | HTTP/2、HTTP/1.1、h2、ALPN、HPACK、SETTINGS、HEADERS、DATA、WINDOW_UPDATE、PRIORITY、PUSH_PROMISE、GOAWAY、END_STREAM、END_HEADERS、ENABLE_PUSH、MAX_CONCURRENT_STREAMS、Stream ID、:method、:scheme、:authority、:path、:status、keep-alive、half-closed (local)、closed、in flight、waiting、done、in order、1 segment missing、User-Agent、QUIC |
| QUIC | HTTP/3、UDP、Initial、Handshake、0-RTT、1-RTT、CRYPTO、ACK、STREAM、PADDING、HANDSHAKE_DONE、FIN、PTO、Destination Connection ID、DCID、SCID、Packet number、ALPN h3、quic_transport_parameters、pre_shared_key、early_data、NewSessionTicket、Retry、QPACK、Alt-Svc、in progress、complete、confirmed、discarded、sent、sent (0-RTT)、0-RTT rejected、1 packet missing |
| WebSocket | WebSocket、ws://、wss://、Upgrade、Connection: Upgrade、Sec-WebSocket-Key、Sec-WebSocket-Accept、Sec-WebSocket-Version、Sec-WebSocket-Protocol、Sec-WebSocket-Extensions、101 Switching Protocols、403 Forbidden、426 Upgrade Required、GUID、SHA-1、base64、FIN（フレームのビット。TCP FIN とは文脈で区別する）、RSV1-3、Opcode、MASK、Masking key、Payload length、Header bytes、Text、Binary、Continuation、Close、Ping、Pong、readyState、CONNECTING、OPEN、CLOSING、CLOSED、open、message、error、close、wasClean、binaryType、Blob、1000、1001、1002、1005、1006、1008、1009、1011、1015、permessage-deflate、extended CONNECT、:protocol、Server-Sent Events、EventSource、CSWSH、TCP FIN、hb-1（状態とフィールドの値 waiting for 101、Accept OK、Accept mismatch、allowed: …、Ping sent、Pong received、Pong timeout、(forgotten)、1000 (normal closure)、N bytes、N fragments、message: …、error, close: 1006、close: 1000, wasClean true と、表の列 Stage、Value も翻訳しない。Text、Binary、Continuation はラベルとフィールドの値。本文ではテキスト、バイナリー、継続と書く） |
| メールの送信ドメイン認証 | SPF、DKIM、DMARC、ARC、SMTP、MX、EHLO、MAIL FROM、RCPT TO、DATA、From、To、Subject、DKIM-Signature、Authentication-Results、Received、List-Id、_domainkey、_dmarc、v=spf1、ip4、-all、~all、?all、v=DKIM1、k=rsa、d=、s=、h=、bh=、b=、c=、relaxed、strict、v=DMARC1、p=none、p=quarantine、p=reject、adkim、aspf、rua、pass、fail、softfail、neutral、none、temperror、permerror、RFC5321.MailFrom、RFC5322.From、250、550 5.7.1、SRS、smtp.mailfrom、header.d、header.from、accept、accept (p=none)、quarantine、reject、reject (550 5.7.1)、yes、no（状態の値と表の列・行 Identifier、Domain、Result、Aligned、SPF (MAIL FROM)、DKIM (d=)、From (header)、Name、TXT も翻訳しない） |
| Wi-Fi（802.11） | 802.11、WPA2、WPA2-Personal、WPA2-PSK、WPA3、WPA3-Personal、WEP、SAE、PMF、802.11w、RSN、RSNA、RSNE、AKM、CCMP、CCMP-128、PBKDF2、HMAC-SHA1、PRF-384、AES Key Wrap、KRACK、SSID、BSSID、BSS、ESS、IBSS、DS、STA、AP、TSF、TU、TIM、DTIM、Beacon、Probe Request、Probe Response、Authentication、Association Request、Association Response、Deauthentication、Open System、AID、EAPOL、EAPOL-Key、802.1X、ANonce、SNonce、PMK、PTK、GTK、KCK、KEK、TK、MIC、KDE、Key Information、Key Replay Counter、Install、Key Ack、Key MIC、Secure、Encrypted Key Data、Frame Control、ToDS、FromDS、Retry、Protected、Duration、Address 1〜3、RA、TA、DA、SA、Ack（802.11 のフレーム。TCP の ACK とは別）、RTS、CTS、NAV、CCA、SIFS、DIFS、AIFS、CW、CSMA/CA、CSMA/CD、DCF、EDCA、OFDM、ATIM、Wi-Fi Direct、802.11s（状態の値 State 1〜4（State N (unauthenticated) などの説明付き）、… (channel …, WPA2-PSK)、EAPOL only、open、not used、derived、installed、received、duplicate discarded、MIC invalid (discarded)、MIC valid、EAPOL-Key 4/4 (MIC valid)、Ack received、Ack received (CW back to …)、Beacon (from STA B)、DIFS … + N × … (CW …)、sending (…)、no Ack: …、NAV … (busy)、NAV expired: …、paused (hears the AP’s Ack)、collision (nothing decoded)、ignored (not an AP)、Beacon (TSF synced)、CTS for STA …、Data from STA … (…)、IBSS started、looking for …、joined …、理由コードの 4-way handshake timeout と、表の列 SSID、BSSID、Security、Via、Key、Bits、Value、MAC、State、AID も翻訳しない） |
| リバースプロキシとロードバランサー | Forwarded、for、by、host、proto、X-Forwarded-For、X-Forwarded-Proto、Via、Host、:authority、:scheme、:method、:path、:status、Connection、Keep-Alive、Proxy-Connection、TE、Transfer-Encoding、Upgrade、Location、Proxy-Status、Retry-After、Authorization、Set-Cookie、Cookie、Cache-Status、connection_terminated、connection_refused、http_response_timeout、destination_unavailable、next-hop、hit、fwd、uri-miss、stored、ttl、s-maxage、private、public、must-revalidate、502 Bad Gateway、503 Service Unavailable、504 Gateway Timeout、201 Created、SERVERID、Path、Secure、HttpOnly、PROXY protocol、SNI、ALPN、h2、L4、L7、DSR、SNAT、HAProxy、nginx、NGINX Plus、/healthz、FIN、RST（状態の値 unknown、up、down、idle、in use、closed、not visible、running、crashed、busy (45 s)、order 1001 created、terminated (cert …)、passthrough (ciphertext only)、B (A by cookie)、A (B is down)、h2, TLS 1.3 to …、TCP to …、TLS 1.3 (cert on A)、フィールド名 Frames、Removed、Line、Visible to the LB、Inside (encrypted)、Request line、Status line、Body、Flags、Dst、Dst port、Handshake、Certificate と、表の列 Backend、Address、Health、Fails、Conn、Requests、State、URL、Cache-Control、Age、Status、Field、Value、TCP peer、Scheme、Forwarded for、Forwarded proto、PROXY src、TLS も翻訳しない） |
| Cookie と CSRF | SameSite、Strict、Lax、None、Default、Lax-allowing-unsafe、Lax+POST、Set-Cookie、Cookie、Secure、HttpOnly、Path、Domain、__Host-、__Secure-、Sec-Fetch-Site、Sec-Fetch-Mode、Sec-Fetch-Dest、Sec-Fetch-User、same-origin、same-site、cross-site、none、navigate、document、?1、Origin、303 See Other、403 Forbidden、200 OK、application/x-www-form-urlencoded、multipart/form-data、text/plain、form.submit()、location、PSL、OWASP、ambient authority（状態の値 sid sent、sid withheld (Lax)、sid withheld (Strict)、no cookie for evil.example、transferred (to mallory)、403 (no session)、403 (csrf missing)、403 (cross-site)、(not sent)、(none)、(missing)、bank.example (host-only)、yes、1000 USD、0 USD と、表の列 Name、Value、Domain、Path、SameSite、Secure、HttpOnly、Session、User、CSRF token、Initiator の値 bank.example page、redirect from /login、user (link in an email app)、evil.example page (form.submit())、evil.example page (location = …)、link on evil.example (click)、フィールド名 Initiator、Request line、Status line、Location、Host、Content-Type、Body、csrf も翻訳しない） |
| HSTS | HSTS、Strict-Transport-Security、max-age、includeSubDomains、preload、sslstrip、Known HSTS Host、301 Moved Permanently、303 See Other、308 Permanent Redirect、Location、Set-Cookie、Cookie、Secure、HttpOnly、Domain、Path、SID、lang、unknown_ca、SNI、HTTPS RR、HTTPS-First、HTTPS-Only、TOFU（状態の値 no match、expired (evicted)、congruent: …、superdomain: … (includeSubDomains)、(built in)、header、preload list、yes、no、waiting for http、stripping、relaying TLS (ciphertext only)、posing as example.com、holding alice’s session、(removed)、(ciphertext only)、http from …、https from …、none (http)、TLS 1.3, cert OK、aborted: unknown_ca、error page (no proceed)、http://example.com/ (not secure)、https://… (HSTS upgrade)、alice (from …)、https from … (alice’s session)、ClientHello / ServerHello only と、表の列 Host、Subdomains、Expires、Source、Name、Value、Secure、Field、TLS records、フィールド名 TCP、Request line、Status line、Body、Handshake、Certificate、server_name、AlertDescription、Visible to the attacker も翻訳しない） |
| Server-Sent Events | Server-Sent Events、SSE、EventSource、text/event-stream、data、event、id、retry、message、open、error、Last-Event-ID、lastEventId、readyState、CONNECTING、OPEN、CLOSED、close()、onmessage、onerror、withCredentials、Accept、Cache-Control、no-cache、no-store、Pragma、Content-Type、Content-Length、Transfer-Encoding、chunked、200 OK、204 No Content、text/html、application/json、HEADERS、DATA、SETTINGS、MAX_CONCURRENT_STREAMS、END_STREAM、:status、:path、:method、FIN、BOM、LF、CR、CRLF（状態の値 UA default、5000 ms、""、waiting、streaming、queued、idle、closed、open、live、ended と、表の列 type、data、lastEventId、id、event、Conn、Request、State、イベントの種類 price、news、フィールド名 On connection、Request line、Status line、Chunk size、Lines、Body、Stream ID、Flags、Host、accept、content-type、SETTINGS_MAX_CONCURRENT_STREAMS も翻訳しない） |
| コンテナーのネットワーク | veth、eth0、docker0、br-7c3f9e2a1d4b、vethA、vethB、netns、MASQUERADE、masquerade、SNAT、DNAT、conntrack、prerouting、postrouting、ip_forward、iptables、nftables、docker-proxy、userland-proxy、-p、--publish、docker run、docker network create、127.0.0.11、nameserver、db、FDB、SYN_SENT、SYN_RECV、ESTABLISHED、CLOSE、LISTEN、SYN-RECEIVED、OPER、SPA、SHA、TPA、who-has、is-at（状態の値 local、learned、on-link、default、flood、forward、filter、local: up to the host、masquerade: src →、dnat: dst →、conntrack: dst →、no rule: for the host itself、RST: nothing listens on port 80、ARP: … is mine、conntrack: src →、recomputed、LISTEN 0.0.0.0:80、SYN-RECEIVED from …、ESTABLISHED with …、from …、to …、eth0 ⇄ … (veth pair)、… (bridge interface)、eth0 (host)、1 (request)、2 (reply)、db → … (via 127.0.0.11)、eth0 172.17.0.2/16 などのインターフェースの値と、表の列 Destination、Gateway、Dev、IP、MAC、Port、Type、Hook、Match、Action、Proto、Original、Reply、State、フィールド名 Link、Eth Dst、Eth Src、Src、Dst、TTL、Flags、Translation、Checksums も翻訳しない。conntrack の状態は Linux の名前（SYN_SENT）で、RFC の名前（SYN-SENT）と区別する） |
| VXLAN | VXLAN、VTEP、VNI、NVE、EVPN、BGP、Geneve、NVGRE、GRE、IGMP、PIM、ECMP、BUM、4789、8472、vxlan100、vethA〜vethD、dstport、srcport、nolearning、proxy、group、dev、df、ttl、spine 1、spine 2、Echo Request、Echo Reply、MSS、RTO（状態の値 encap: …、decap: …、flood: …、drop: …、route: …、multicast: …、ECMP: via …、proxy ARP: …、local、learned、static、connected と、表の列 VNI、MAC、Where、Type、Send to、Ports、Group、Members、Outer src port、Path、Destination、Next hop、フィールド名 Outer Eth Dst、Outer Eth Src、Outer IP Src、Outer IP Dst、TTL、Total Length、UDP Src、UDP Dst、UDP Checksum、VXLAN、VNI、Path、Inner … も翻訳しない。EVPN の DF（Designated Forwarder）は DF ビットと関係がないので書かない） |
| WireGuard | WireGuard、wg、wg0、wlan0、wg-quick、Noise、IKpsk2、X25519、Curve25519、ChaCha20-Poly1305、XChaCha20-Poly1305、Poly1305、BLAKE2s、HKDF、AEAD、XAEAD、TAI64N、AllowedIPs、Endpoint、ListenPort、PersistentKeepalive、pub:laptop などの鍵の名前、E_pub(…)、Handshake Initiation、Handshake Response、Cookie Reply、Transport Data、mac1、mac2、R_m、REKEY_AFTER_TIME、REJECT_AFTER_TIME、REKEY_TIMEOUT、KEEPALIVE_TIMEOUT、51820、IPsec、IKEv2、ESP、Destination Unreachable、ラベルの [keepalive]（本文ではキープアライブと訳す）（状態の値 out: …、in: …、drop: …、rekey: …、endpoint → …、under load (cookie required)、not under load、previous、current、next、#1、#2、greatest … と、表の列 Peer、Endpoint、AllowedIPs、Latest handshake、Keepalive、Slot、Keypair、Packet、Captured from、フィールド名 Outer Src、Outer Dst、IP Length、UDP Length、Type、Sender、Receiver、Ephemeral、Static、Timestamp、Empty、Counter、Inner …、Padding、Tag、Nonce、Cookie も翻訳しない。cookie は HTTP の Cookie とは別物で、小文字で書く） |
| ARP スプーフィング | DAI、Dynamic ARP Inspection、DHCP snooping（本文では DHCP スヌーピング）、ARP ACL、ARP Announcement、Gratuitous ARP、SAVI、VRRP、RA Guard、SEND、arp_accept、PERMANENT、permanent、dynamic、static（状態の値 forward: port …、forward: port … (no inspection)、permit … ↔ …（ARP ACL の行）、bypass: trusted port …、permit: bound …、permit: ARP ACL …、drop: no binding for …、drop: denied by ARP ACL …、bound: …、updated: …、added: …、unchanged: …、ignored: static entry、ignored: not the target、port 2 (gateway, DHCP server)、… (gateway)、… (attacker) と、表の列 IP、MAC、Type、Port、Lease、Packet、Forwarded to も翻訳しない） |
| OAuth 2.0 と OpenID Connect | OAuth 2.0、OAuth 2.1、OpenID Connect、OIDC、PKCE、S256、plain、JWT、JWS、Discovery、DPoP、Bearer、Basic、client_secret_basic、response_type、client_id、client_secret、redirect_uri、scope、state、nonce、code、code_verifier、code_challenge、code_challenge_method、iss、sub、aud、exp、iat、jti、kid、alg、typ、at+jwt、RS256、grant_type、authorization_code、refresh_token、access_token、id_token、token_type、expires_in、invalid_grant、invalid_token、Resource Owner Password Credentials、Preserve log、Authorization、WWW-Authenticate、Cache-Control、Pragma、no-store、no-cache、302 Found、400 Bad Request、401 Unauthorized（状態の値 state OK …、state mismatch: …、code_verifier: S256 match、no code_challenge on record: nothing to check、with PKCE: …、redirect_uri: exact match、refresh_token: active → rotated、active、rotated (invalid)、not requested、not computed here、logged in as alice at …、code for mallory + state …、session … と、表の列 Value、Where、Session、User、Claim、Check、Token、Expires、Used、Refresh token、Status、Result、フィールド名 Request line、Status line、Host、Location、Set-Cookie、Cookie、Body、Access token claims、ID token claims も翻訳しない） |
| BGP とエニーキャスト | BGP、BGP-4、eBGP、iBGP、AS、AS_PATH、AS_SEQUENCE、ORIGIN、IGP、NEXT_HOP、NLRI、LOCAL_PREF、MED、OPEN、UPDATE、KEEPALIVE、NOTIFICATION、Marker、Hold Time、Hold Timer、KeepaliveTimer、Capability、BGP Identifier、Withdrawn Routes、Idle、Connect、Active、OpenSent、OpenConfirm、Established、FIB、BFD、RPKI、catchment、looking glass、id.server、hostname.bind、NSID、Hold Timer Expired（状態の値 best: …、drop: own AS … in AS_PATH、no route to …、… s left、expired、withdrawn、connected、up、down (…)、✓、ESTABLISHED (…)、CLOSED (connection reset)、example.com A … (from Site A) と、表の列 Prefix、From、AS_PATH、NEXT_HOP、Best、Next hop、Via、フィールド名 Transport、Length、Type、Version、My Autonomous System、Optional Parameters Length、Total Path Attribute Length、Withdrawn Routes Length、Error Code、Error Subcode、IP Src、IP Dst、UDP Src、UDP Dst、TCP Src、TCP Dst、Question、Answer、Flags、Seq、Ack、Len も翻訳しない。Site A・Site B・Transit は表の値。本文では拠点 A・拠点 B・トランジット事業者と書く） |
| パケットの層（Wireshark の表示名） | Ethernet II、Address Resolution Protocol、Internet Protocol Version 4、Internet Control Message Protocol、User Datagram Protocol、Transmission Control Protocol、Domain Name System（層の 1 行の要約も、フィールドの名前と値から作るので翻訳しない。DNS のテーマのフィールド名 IP Src、IP Dst、UDP Src、UDP Dst も翻訳しない） |

## 3. 訳語の対応表

| 英語 | 日本語 | 備考 |
|---|---|---|
| server | サーバー | |
| client | クライアント | |
| resolver | リゾルバー | JPRS の表記に合わせる |
| stub resolver | スタブリゾルバー | |
| full-service resolver | フルサービスリゾルバー | |
| authoritative server | 権威サーバー | |
| root server | ルートサーバー | |
| name server | ネームサーバー | |
| top-level domain (TLD) | トップレベルドメイン（TLD） | |
| referral | 紹介 | 担当のサーバーを教える応答（委任の応答） |
| delegation | 委任 | ゾーンの管理を下位のサーバーに任せること |
| chain of trust | 信頼の連鎖 | |
| trust anchor | トラストアンカー | 状態の値としては trust anchor、pending、DS pending、DS verified、no DS、signature invalid、RRSIG expired、no AD のまま書く |
| validating resolver | 検証するリゾルバー | |
| key-signing key / zone-signing key | 鍵署名鍵（KSK）／ゾーン署名鍵（ZSK） | |
| digest | ダイジェスト | |
| sign / re-sign | 署名する／再署名する | |
| validate | 検証する | |
| authenticated denial of existence | 不在証明 | |
| insecure delegation | 署名のない委任 | |
| forged / altered | 偽の／書き換えられた | |
| confidentiality | 機密性 | |
| Secure / Insecure / Bogus | （翻訳しない） | 初出で「検証できた／署名がない／偽物」を添える |
| query | 問い合わせ | フィールド名の QNAME などは訳さない |
| response / answer | 応答 | |
| cache | キャッシュ | |
| negative response | 否定応答 | NXDOMAIN など |
| negative caching | 否定応答のキャッシュ（否定キャッシュ） | RFC 2308 |
| browser | ブラウザー | |
| handshake | ハンドシェイク | 「ハンドシェーク」としない |
| three-way handshake | 3 ウェイハンドシェイク | |
| four-way close | 4 ウェイクローズ | 定着した訳語ではないので、初出で「接続の終了（4 つのセグメントのやり取り）」と説明を添える |
| half-close | ハーフクローズ（半分だけ閉じた状態） | 片方の向きだけが閉じている |
| reset (RST) | リセット（RST） | |
| abort | 中断 | RST で接続を打ち切ること。close（閉じる）と区別する |
| simultaneous close | 同時クローズ | |
| segment | セグメント | TCP の単位。IP の単位は「パケット」 |
| packet | パケット | |
| sequence number | シーケンス番号 | |
| acknowledgment number | 確認応答番号 | 「アクノリッジ」としない |
| acknowledgment | 確認応答 | |
| retransmission | 再送 | |
| retransmission timeout | 再送タイムアウト（RTO） | |
| exponential backoff | 指数バックオフ | |
| timer | タイマー | |
| loss / lost | ロス／失われる | |
| port | ポート | スイッチのポートにも使う（TCP のポート番号とは文脈で区別する） |
| link-local address | リンクローカルアドレス | fe80::/10 |
| global unicast address | グローバルユニキャストアドレス | |
| unique local address | ユニークローカルアドレス | fc00::/7 |
| unspecified / loopback address | 未指定アドレス／ループバックアドレス | |
| IPv4-mapped address | IPv4 射影アドレス | ::ffff:0:0/96 |
| multicast / multicast scope | マルチキャスト／マルチキャストの範囲（scope） | |
| solicited-node multicast address | 要請ノードマルチキャストアドレス | |
| interface ID | インターフェース ID | |
| documentation address | 文書用のアドレス | RFC 3849、RFC 9637、RFC 5737 |
| congestion control | 輻輳制御 | |
| sender / receiver | 送信側／受信側 | |
| round (round trip) | ラウンド（往復） | 輻輳制御のテーマで、1 RTT 分のやり取り |
| duplicate ACK | 重複 ACK | |
| fast retransmit | 高速再送 | |
| fast recovery | 高速リカバリ | |
| congestion avoidance | 輻輳回避 | |
| slow start threshold (ssthresh) | スロースタートのしきい値（ssthresh） | |
| flight size | 送信中のデータ（FlightSize） | 送ったが累積の確認応答をまだ受けていない量 |
| loss window | ロスウィンドウ | RTO の後の cwnd（1 セグメント） |
| AIMD (additive increase, multiplicative decrease) | AIMD（加算的増加・乗算的減少） | |
| congestion window | 輻輳ウィンドウ（cwnd） | |
| slow start | スロースタート | |
| certificate | 証明書 | |
| certificate chain | 証明書チェーン | |
| intermediate certificate | 中間証明書 | |
| root certificate | ルート証明書 | |
| trust store | 信頼ストア | |
| signature | 署名 | |
| expired | 期限切れ | |
| name mismatch | 名前の不一致 | |
| encrypted | 暗号化された | |
| key exchange | 鍵交換 | |
| header | ヘッダー | |
| email authentication | 送信ドメイン認証 | |
| envelope / envelope sender | エンベロープ／エンベロープの送信者 | SMTP の MAIL FROM |
| sending server / receiving server | 送信サーバー／受信サーバー | |
| mailing list | メーリングリスト | |
| alias | エイリアス | メールの転送 |
| spoofing / forged mail | なりすまし／偽のメール | |
| selector | セレクター | DKIM |
| alignment | アライメント | 識別子のドメインと From のドメインの一致。「アラインする」 |
| organizational domain | 組織ドメイン | |
| aggregate report | 集約レポート | DMARC |
| bounce | バウンス | 配送のエラーの通知 |
| body hash | 本文のハッシュ | |
| canonicalization | 正規化 | |
| public key / private key | 公開鍵／秘密鍵 | |
| domain owner | ドメインの所有者 | |
| inbox / spam folder | 受信箱／迷惑メールフォルダー | |
| encapsulation | カプセル化 | |
| ARP cache | ARP キャッシュ | |
| ARP request / reply | ARP の要求／応答 | |
| next hop | ネクストホップ | |
| lease / lease time | リース／リース期間 | |
| relay agent | リレーエージェント | |
| option (DHCP) | オプション | 番号で呼ぶ（オプション 53 など） |
| router | ルーター | |
| private address / public address | プライベートアドレス／グローバルアドレス | public は「グローバル」と訳す |
| NAT table (mapping) | NAT の変換表（対応） | |
| port forwarding | ポートフォワーディング | |
| carrier-grade NAT | キャリアグレード NAT | |
| hairpinning | ヘアピン | |
| container | コンテナー | 長音を付ける（用語集のテストで検査する） |
| network namespace | ネットワーク名前空間 | |
| veth pair | veth ペア | |
| bridge (Linux) | ブリッジ | スイッチと同じ働きをする、ホストの中の仮想のスイッチ |
| publish a port / published port | ポートを公開する／公開したポート | Docker の -p |
| masquerade | マスカレードする | 送信元を、出ていくインターフェースのアドレスに書き換えること |
| embedded DNS server | 組み込みの DNS サーバー | Docker の 127.0.0.11 |
| user-defined network / default bridge network | ユーザー定義のネットワーク／既定のブリッジネットワーク | |
| IP forwarding | IP 転送 | |
| overlay / underlay network | オーバーレイ／アンダーレイのネットワーク | |
| tunnel | トンネル | |
| decapsulation | カプセル化を解く | |
| outer / inner header | 外側／内側のヘッダー | |
| VXLAN segment | VXLAN のセグメント | |
| tenant | テナント | |
| head-end (ingress) replication | 送信元での複製 | RFC 8365 の ingress replication |
| flood list | 流す先の一覧 | |
| control plane | コントロールプレーン | |
| multicast group | マルチキャストグループ | |
| equal-cost multipath (ECMP) | 等コストの経路（ECMP） | |
| split horizon | スプリットホライズン | |
| proxy ARP | 代理 ARP | |
| jumbo frame | ジャンボフレーム | |
| forwarding table (FDB, VTEP) | 転送の表（FDB） | VTEP の表。スイッチの MAC アドレステーブルとは行き先（相手の VTEP）を持つ点が違う |
| neighbor table (VTEP) | 近隣の表 | 代理 ARP に使う IP と MAC の対応。IPv6 の近隣キャッシュとは別 |
| cryptokey routing | 暗号鍵ルーティング | WireGuard |
| peer | ピア | |
| roaming | ローミング | |
| keypair (session keys) | 鍵の組 | WireGuard の previous・current・next の枠 |
| rekey | 鍵の更新 | |
| initiator / responder | 始めた側／応じた側 | |
| ephemeral / static key | 一時的な鍵／静的な鍵 | |
| authenticated encryption (AEAD) | 認証付き暗号 | |
| replay window | リプレイの窓 | |
| under load | 負荷が高い | |
| perfect forward secrecy | 前方秘匿性 | |
| remote-access VPN | リモートアクセス VPN | |
| switch | スイッチ | |
| MAC address table | MAC アドレステーブル | |
| learning | 学習 | スイッチが送信元の MAC アドレスとポートを記録すること |
| flooding | フラッディング | 初出で「（ほかの全ポートに流す）」と説明する |
| ageing / ageing time | エージング／エージングタイム | |
| forwarding / filtering | 転送／フィルタリング | |
| unknown unicast | 宛先不明のユニキャスト | |
| hub | ハブ | |
| broadcast domain | ブロードキャストドメイン | |
| access port / trunk port | アクセスポート／トランクポート | |
| tagged frame / tag | タグ付きフレーム／タグ | 802.1Q のタグ |
| subinterface | サブインターフェース | |
| router-on-a-stick | 1 本のトランクでつないだルーター | 初出で説明する |
| L3 switch | L3 スイッチ | |
| fresh / stale | 新しい／古い | 状態の値としては fresh / stale のまま書く |
| revalidation / conditional request | 再検証（確かめる）／条件付きの要求 | |
| private cache / shared cache | プライベートキャッシュ／共有キャッシュ | |
| origin / cross-origin | オリジン／オリジンをまたぐ | オリジンはスキーム・ホスト・ポートの組 |
| preflight | プリフライト | |
| credentials | 資格情報 | Cookie など。値としての `credentials: include` は翻訳しない |
| network error | ネットワークエラー | |
| same-origin policy | 同一オリジンポリシー | |
| home router / ISP router | 家庭のルーター／ISP のルーター | |
| hop | ホップ | |
| probe | プローブ | traceroute が送るパケット |
| time to live (TTL) | 生存時間（TTL） | |
| default gateway | デフォルトゲートウェイ | |
| broadcast / unicast | ブロードキャスト／ユニキャスト | |
| OSI reference model | OSI 参照モデル | |
| TCP/IP model | TCP/IP モデル | |
| application / presentation / session layer | アプリケーション層／プレゼンテーション層／セッション層 | OSI の第 7〜5 層 |
| transport / network / data link / physical layer | トランスポート層／ネットワーク層／データリンク層／物理層 | OSI の第 4〜1 層 |
| internet layer / link layer | インターネット層／リンク層 | TCP/IP の層 |
| frame | フレーム | データリンク層の単位。HTTP/2 のフレームも同じ語で、文脈で区別する |
| stream | ストリーム | HTTP/2・QUIC の、1 つの要求と応答のやり取り |
| multiplexing | 多重化 | |
| head-of-line blocking | ヘッドオブラインブロッキング | 初出で「（HOL ブロッキング）」と添えてもよい |
| connection preface | 序文（接続の序文） | HTTP/2 |
| static table / dynamic table | 静的テーブル／動的テーブル | HPACK |
| receive buffer | 受信バッファー | |
| pipelining | パイプライン | |
| datagram | データグラム | UDP の単位 |
| connection ID | 接続 ID | |
| packet number / packet number space | パケット番号／パケット番号の空間 | QUIC |
| encryption level | 暗号化レベル | QUIC（Initial・Handshake・0-RTT・1-RTT） |
| early data | 早期データ（0-RTT のデータ） | |
| session ticket / resumption | セッションチケット／再開 | |
| probe timeout (PTO) | プローブタイムアウト（PTO） | |
| flow control | フロー制御 | |
| receive window / advertised window | 受信ウィンドウ | |
| send window / usable window | 送信ウィンドウ／使えるウィンドウ | |
| zero window | ゼロウィンドウ | |
| window probe / persist timer | ウィンドウプローブ／パーシストタイマー | |
| window update | ウィンドウの更新 | |
| silly window syndrome | シリーウィンドウシンドローム（SWS） | |
| delayed ACK | 遅延 ACK | |
| Neighbor Discovery | 近隣探索 | |
| neighbor cache | 近隣キャッシュ | |
| duplicate address detection | 重複アドレス検出（DAD） | |
| stateless address autoconfiguration | ステートレスアドレス自動設定（SLAAC） | |
| Router / Neighbor Solicitation, Advertisement | （翻訳しない） | 初出で「ルーターを探す／知らせる」「近隣に尋ねる／知らせる」と説明する |
| unspecified address | 未指定アドレス | :: |
| cumulative ACK | 累積の確認応答 | |
| partial ACK | 部分的な確認応答 | |
| hole | 抜け | 受け取っていない範囲 |
| out of order | 順序が入れ替わった | |
| scoreboard | スコアボード | |
| tail loss | 末尾のロス | |
| tail loss probe (TLP) | テールロスプローブ | RACK-TLP、RFC 8985 |
| selective acknowledgment (SACK) | 選択的確認応答（SACK） | |
| replay (attack) | リプレイ（リプレイ攻撃） | 「再送」は送り手の正当な再送信だけに使う |
| server push | サーバープッシュ | HTTP/2 |
| opening handshake / closing handshake | 開始のハンドシェイク／終了のハンドシェイク | WebSocket |
| upgrade (protocol switch) | アップグレード（プロトコルの切り替え） | |
| masking / mask | マスク／マスクする | 暗号化ではない |
| masking key | マスクキー | |
| payload / payload length | ペイロード／ペイロード長 | |
| data frame / control frame / continuation frame | データフレーム／制御フレーム／継続フレーム | WebSocket |
| status code (Close) | ステータスコード | WebSocket |
| heartbeat | ハートビート | |
| fail the WebSocket connection | 接続を失敗にする | |
| polling / long polling | ポーリング／ロングポーリング | |
| cross-site WebSocket hijacking | クロスサイト WebSocket ハイジャック（CSWSH） | |
| hop-by-hop header | 区間ごとのヘッダー | |
| trailer | トレーラー | |
| MAC address | MAC アドレス | |
| routing | 経路制御 | |
| routing table / route | 経路表／経路 | 「ルーティングテーブル」は初出の言い換えに限る |
| longest prefix match | 最長一致 | |
| default route | デフォルト経路 | `0.0.0.0/0` |
| directly connected | 直接接続 | |
| metric | メトリック | |
| stateful firewall | ステートフルファイアウォール | |
| packet filter | パケットフィルター | |
| connection tracking | 接続の追跡 | |
| state table | 状態表 | |
| rule / policy | ルール／ポリシー | |
| default deny | 既定で拒否 | |
| inbound / outbound | 内向き／外向き | |
| unsolicited | 頼んでいない | |
| NAT traversal | NAT 越え | 初出で「NAT トラバーサル」と添える |
| candidate / host candidate | 候補／ホスト候補 | ICE |
| server-reflexive / peer-reflexive / relayed candidate | server reflexive の候補（srflx）／peer reflexive の候補（prflx）／relay の候補 | |
| base (of a candidate) | 基底 | 実際に送るアドレス |
| connectivity check / triggered check | 接続性チェック／トリガーされたチェック | |
| candidate pair / checklist / valid pair / selected pair | 候補ペア（ペア）／チェックリスト／有効なペア／選ばれたペア | |
| nominate / nomination | 指名する／指名 | |
| controlling / controlled agent | controlling の側（制御する側）／controlled の側 | |
| hole punching | ホールパンチング | |
| relay (verb) / relayed address | 中継する／中継のアドレス | |
| allocation / permission / channel | 割り当て／許可／チャネル | TURN |
| long-term / short-term credential | 長期の資格情報／短期の資格情報 | |
| realm / nonce / magic cookie / transaction ID | レルム／ノンス／マジッククッキー／トランザクション ID | |
| endpoint-independent / address- and port-dependent mapping | 宛先によらない対応づけ／宛先のアドレスとポートごとの対応づけ | RFC 4787 |
| “symmetric” NAT | いわゆるシンメトリック NAT | RFC 4787 はこの呼び方を避ける |
| signalling / offer / answer | シグナリング／オファー／アンサー | SDP の answer。STUN の response は「応答」 |
| username fragment | ユーザー名のフラグメント（ufrag） | |
| keepalive | キープアライブ | |
| drop / reject | 黙って捨てる／拒否する | reject は「RST か ICMP のエラーで答える」 |
| pseudo-connection | 擬似的な接続 | UDP |
| idle timer / idle timeout | アイドルタイマー／アイドルタイムアウト | |
| port scan / scanner | ポートスキャン／スキャナー | |
| connection refused | 接続の拒否（connection refused） | |
| path MTU discovery | パス MTU 探索 | |
| path MTU | パス MTU | 経路の途中のリンクの MTU のうち最小のもの |
| fragment / fragmentation | フラグメント／フラグメント化 | 動詞は「分割する」 |
| reassembly | 組み立て直し（再構成） | 宛先だけが行う |
| next-hop MTU | 次のリンクの MTU | |
| (path MTU) black hole | （パス MTU の）ブラックホール | |
| access point | アクセスポイント | |
| station | STA（端末） | 802.11 の用語としては STA と書く |
| association | アソシエーション | |
| deauthenticate | 認証を解除する | |
| passive scanning / active scanning | パッシブスキャン／アクティブスキャン | |
| beacon | ビーコン | フレームの名前は Beacon |
| 4-way handshake | 4 ウェイハンドシェイク | |
| passphrase | パスフレーズ | |
| pairwise master key / pairwise transient key / group temporal key | ペアワイズマスター鍵（PMK）／ペアワイズ一時鍵（PTK）／グループ一時鍵（GTK） | |
| distribution system | ディストリビューションシステム（DS） | |
| infrastructure mode / ad hoc mode | インフラストラクチャモード／アドホックモード | |
| hidden node | 隠れ端末 | |
| collision / collision avoidance | 衝突／衝突回避 | |
| carrier sense / virtual carrier sense | キャリアセンス／仮想キャリアセンス | |
| backoff | バックオフ | |
| contention window | コンテンションウィンドウ（CW） | |
| slot | スロット | |
| network allocation vector | ネットワーク割り当てベクター（NAV） | |
| radio range | 電波の届く範囲 | |
| offline dictionary attack | オフラインの辞書攻撃 | |
| downgrade | 格下げ | |
| reverse proxy | リバースプロキシ | RFC 9110 では gateway と呼ぶ |
| gateway (HTTP) | ゲートウェイ | 502 / 504 の Gateway。デフォルトゲートウェイとは別 |
| intermediary | 仲介者 | RFC 9110 §3.7 |
| load balancer / load balancing | ロードバランサー／負荷分散 | 「ロードバランサ」としない |
| backend (server) | バックエンド（サーバー） | |
| round robin | ラウンドロビン | |
| health check (active / passive) | ヘルスチェック（能動的／受動的） | |
| sticky session | スティッキーセッション | |
| TLS termination / passthrough | TLS の終端／パススルー | |
| persistent connection / connection reuse | 持続的な接続／接続の使い回し | |
| idempotent | べき等 | |
| retry | 再試行 | TCP の再送（retransmission）と区別する |
| timeout | タイムアウト | |
| shared cache | 共有キャッシュ | |
| cross-site request forgery (CSRF) | クロスサイトリクエストフォージェリ（CSRF） | |
| site / same-site / cross-site | サイト／同じサイト／サイトをまたぐ | サイトはスキームと登録可能ドメインの組。値の same-site などは翻訳しない |
| registrable domain | 登録可能ドメイン | |
| public suffix / Public Suffix List | パブリックサフィックス／Public Suffix List（PSL） | |
| session / session cookie | セッション／セッション Cookie | |
| CSRF token / synchronizer token | CSRF トークン／シンクロナイザートークン | |
| top-level navigation | トップレベルのナビゲーション | |
| safe method | 安全なメソッド | RFC 9110 §9.2.1 |
| attacker | 攻撃者 | |
| ARP spoofing / ARP cache poisoning | ARP スプーフィング／ARP キャッシュポイズニング | |
| man in the middle (MITM) | 中間者（MITM） | |
| DHCP snooping binding table | DHCP スヌーピングの束縛表 | 束縛は binding |
| trusted / untrusted port | 信頼するポート／信頼しないポート | DAI、DHCP スヌーピング |
| static ARP entry | 静的な ARP エントリー | |
| address conflict | アドレスの衝突 | RFC 5227 |
| defend (an address) | （アドレスを）守る | RFC 5227 |
| authorization / authentication | 認可／認証 | OAuth は認可、OpenID Connect は認証 |
| authorization server / resource server / resource owner | 認可サーバー／リソースサーバー／リソースオーナー | OAuth の役割 |
| authorization code / authorization code flow | 認可コード／認可コードフロー | |
| authorization request / response | 認可要求／認可応答 | |
| access token / refresh token / ID token | アクセストークン／リフレッシュトークン／ID トークン | |
| token endpoint / authorization endpoint | トークンエンドポイント／認可エンドポイント | |
| consent | 同意 | |
| redirect URI | リダイレクト URI | 値の redirect_uri は翻訳しない |
| public / confidential client | パブリッククライアント／コンフィデンシャルクライアント | RFC 6749 §2.1 |
| front channel / back channel | フロントチャネル／バックチャネル | |
| authorization code injection | 認可コードの注入 | RFC 9700 §4.5 |
| login CSRF | ログイン CSRF | |
| refresh token rotation | リフレッシュトークンのローテーション | RFC 9700 §4.14.2 |
| implicit flow | インプリシットフロー | |
| claim / issuer | クレーム／発行者 | JWT |
| token introspection | トークンイントロスペクション | RFC 7662 |
| autonomous system (AS) | 自律システム（AS） | |
| announce / advertise (a route) | （経路を）広告する | |
| withdraw (a route) | （経路を）取り下げる | |
| best path | 最良経路 | BGP |
| path attribute | 経路の属性 | BGP |
| prepend / prepending | 付け足す／プリペンド | AS_PATH |
| transit provider | トランジット事業者 | |
| anycast | エニーキャスト | |
| site (of an anycast service) | 拠点 | Web のサイト（site）とは別 |
| forwarding table (FIB) | 転送の表（FIB） | ルーターの表。VXLAN の FDB とは別 |
| BGP table (RIB) | BGP の経路の表 | 経路表とは別。最良経路だけが転送の表（FIB）に入る |
| data plane | データプレーン | |
| route leak / hijack | 経路の漏れ／乗っ取り（ハイジャック） | |
| defense in depth | 多層防御 | |
| cookie jar | Cookie の保存場所 | |
| host-only (cookie) | ホストだけ | Domain 属性のない Cookie |
| hidden form / auto-submit | 隠しフォーム／自動送信 | |
| third-party cookie | サードパーティー Cookie | |
| user activation | ユーザーの操作 | Sec-Fetch-User |
| SSL stripping | SSL ストリッピング | |
| known HSTS host | 既知の HSTS ホスト | |
| preload list | プリロードリスト | |
| trust on first use (TOFU) | 初回の信頼（TOFU） | |
| congruent match / superdomain match | 完全一致／上位ドメインとの一致 | RFC 6797 §8.2 |
| upgrade to https | https への書き換え（https に上げる） | プロトコルのアップグレードとは別 |
| no user recourse / click through | 先へ進む手段がない／警告を無視して進む | RFC 6797 §12.1 |
| public Wi-Fi | 公衆 Wi-Fi | |
| domain cookie | ドメインの Cookie | Domain 属性のある Cookie |
| event stream | イベントストリーム | text/event-stream の形式 |
| reconnection time | 再接続の待ち時間 | retry のフィールドで変わる |
| reestablish the connection (EventSource) | 接続を張り直す（接続し直す） | HTML Standard |
| last event ID | 最後のイベント ID | ヘッダー名の Last-Event-ID は翻訳しない |
| fire / dispatch (an event) | （イベントを）発火する／出す | |
| chunked transfer coding / chunk / last chunk | chunked の転送コーディング／チャンク／最後のチャンク | RFC 9112 §7.1 |
| connection limit (per server) | （サーバーごとの）接続数の上限 | ブラウザーの動き |
| buffering | バッファリング | |
| one-way / two-way | 片方向／双方向 | SSE をサーバープッシュと呼ばない（HTTP/2 の push と紛れる） |
| long-lived response | 長く続く応答 | |
| interface | インターフェース | |
| network card | ネットワークカード | |
| layer | 層 | 「レイヤー」は UI の説明など一般的な文脈に限る |
| subnet | サブネット | |
| subnet mask | サブネットマスク | |
| prefix length | プレフィックス長 | |
| broadcast address | ブロードキャストアドレス | |
| network address | ネットワークアドレス | |
| step | ステップ | UI |
| Try it yourself | 手元で試す | 概要の節の見出し。手元のコンピューターでコマンドを試す |
| learning path | 学習の道筋 | UI。対象者別に順番を付けたテーマの一覧 |
| Web developers (path) | Web エンジニア向け | 道筋の名前 |
| Infrastructure and operations (path) | インフラ運用向け | 道筋の名前 |
| Theme n of m | m テーマ中 n 番目 | 道筋の中の位置。「ステップ」はステップ実行に使うので使わない |
| What if… | もしも… | UI |
