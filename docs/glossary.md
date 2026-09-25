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
| シナリオ・クイズ・概要の文末は常体（だ・である）か体言止めにする。UI の案内文（辞書）は敬体（です・ます）にする | 「ポートが閉じている」／「まだ表示するメッセージはありません。」 | × |
| 強調（`**…**`）は全角の記号の直後で閉じない（CommonMark の規則で太字にならない）。記号は強調の外に出す | `**紹介**（委任）` | ○（`overview.test.tsx`） |

## 2. 翻訳しない用語

プロトコルの仕様に出てくる名前は、訳さずに原文のまま書く（コードでは `ProtocolTerm` 型）。必要なら初出で日本語の説明を添える（例: 「SYN（接続の開始を求めるセグメント）」）。

| 分野 | 用語 |
|---|---|
| TCP のフラグ・セグメント | SYN、ACK、SYN, ACK、RST、RST, ACK、FIN |
| TCP の状態 | CLOSED、LISTEN、SYN-SENT、SYN-RECEIVED、ESTABLISHED、FIN-WAIT-1、FIN-WAIT-2、CLOSE-WAIT、CLOSING、LAST-ACK、TIME-WAIT |
| TCP の変数・パラメーター | ISS、IRS、SND.NXT、RCV.NXT、MSS、RTO、RTT、MSL、cwnd、ssthresh |
| DNS のメッセージ・フィールド | QNAME、QTYPE、ID、QR、RD、RA、AA、RCODE、NOERROR、NXDOMAIN、SERVFAIL、TTL |
| DNS のレコード | A、AAAA、NS、CNAME、SOA、MX |
| TLS 1.3 のメッセージ | ClientHello、ServerHello、EncryptedExtensions、Certificate、CertificateVerify、Finished、Alert |
| TLS の拡張・値 | key_share、supported_versions、signature_algorithms、server_name（SNI）、certificate_expired、certificate_unknown、unknown_ca |
| 証明書 | SAN（subjectAltName）、CA、X.509 |
| その他 | IP、IPv4、HTTP、HTTPS、URL、RFC、OSI、CIDR |

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
| query | 問い合わせ | フィールド名の QNAME などは訳さない |
| response / answer | 応答 | |
| cache | キャッシュ | |
| negative response | 否定応答 | NXDOMAIN など |
| negative caching | 否定応答のキャッシュ（否定キャッシュ） | RFC 2308 |
| browser | ブラウザー | |
| handshake | ハンドシェイク | 「ハンドシェーク」としない |
| three-way handshake | 3 ウェイハンドシェイク | |
| four-way close | 4 ウェイクローズ | 定着した訳語ではないので、初出で「接続の終了（4 つのセグメントのやり取り）」と説明を添える |
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
| port | ポート | |
| congestion control | 輻輳制御 | |
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
| encapsulation | カプセル化 | |
| layer | 層 | 「レイヤー」は UI の説明など一般的な文脈に限る |
| subnet | サブネット | |
| subnet mask | サブネットマスク | |
| prefix length | プレフィックス長 | |
| broadcast address | ブロードキャストアドレス | |
| network address | ネットワークアドレス | |
| step | ステップ | UI |
| What if… | もしも… | UI |
