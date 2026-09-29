# NetworkStudy 計画書

ネットワークプロトコルの動きを、1 パケットずつ自分の手で進めながらインタラクティブに学ぶポータルサイト。

## 0. 決定事項

| 項目 | 決定 |
|---|---|
| ターゲット | 初学者〜中級者（基本情報・応用情報の学習者、新人エンジニア）。主対象は PC、スマホは閲覧できれば可 |
| 構成 | 静的 SPA（バックエンドなし） |
| ホスティング | GitHub Pages（`https://fumobox.github.io/NetworkStudy/`） |
| 言語 | 英語・日本語（URL は `/en/...` と `/ja/...`、デフォルトは `en`） |
| 公開範囲 | パブリックリポジトリ、MIT ライセンス |
| TLS | TLS 1.3 のみ扱う（1.2 は扱わない） |
| 進捗・クイズ結果 | localStorage のみ（端末間の同期はしない） |
| 開発体制 | 単独開発。ブランチ保護は「CI 必須」のみで、レビュー承認は必須にしない |
| デザイン | shadcn/ui 標準（後から変更する可能性あり。テーマトークン経由で差し替えやすくしておく） |

## 1. 学習体験の核

1. **ステップ実行シーケンス図**: 前へ／次へ／自動再生／速度変更。各ステップに短い解説を付ける。キーボード操作（← / → / Space）に対応
2. **パケットインスペクタ**: 選択したメッセージのフィールドを表で表示（TCP フラグ、seq/ack、DNS の QTYPE、TLS のメッセージ種別など）
3. **アクター状態パネル**: 各参加者の内部状態（TCP の状態機械、リゾルバのキャッシュ、証明書検証の結果）
4. **What-if 分岐**: トグルで異常系に切り替えると、同じプレイヤーで流れが変わる
5. **理解度クイズ**: テーマごとに 3〜5 問。結果は localStorage に保存
6. **URL での状態共有**: `/ja/themes/tcp-handshake?step=3&opt.synLost=1` のように、ステップと分岐を再現できる

## 2. コンテンツ

### MVP の 3 テーマ

| テーマ | 正常な流れ | What-if | 固有 UI |
|---|---|---|---|
| TCP 3ウェイハンドシェイク | SYN → SYN/ACK → ACK、seq/ack の増え方、状態遷移 | SYN ロス→再送（RTO バックオフ）、ポート閉塞→RST、SYN/ACK ロス | 状態パネルで TCP の状態機械を表示 |
| DNS 名前解決 | スタブ → フルリゾルバ → ルート → TLD → 権威サーバ | キャッシュヒット、NXDOMAIN、CNAME 連鎖、タイムアウト→別サーバへ | リゾルバのキャッシュ表 |
| TLS 1.3 と証明書チェーン検証 | ClientHello → ServerHello + EncryptedExtensions + Certificate + CertificateVerify + Finished → Finished | 期限切れ、SAN 不一致、未知の CA／自己署名、中間証明書の欠落 | `CertChainPanel`（サーバ → 中間 → ルートの順に署名・期限・SAN を ✓/✗） |

サイト上の推奨学習順は DNS → TCP → TLS。実装は TCP から始める（Phase 3 でテーマが増えたので、分類ごとの順にした。§8 の Phase 3 を参照）。

### 将来の追加候補

| 優先度 | テーマ | インタラクション | 状況 |
|---|---|---|---|
| 高 | HTTPS の全体像（DNS→TCP→TLS→HTTP を 1 本につなげる） | 既存シナリオの合成 | Phase 3 で実装 |
| 高 | OSI 参照モデル／カプセル化 | レイヤを積み上げるアニメーション | Phase 3 で実装 |
| 高 | IP／サブネット計算 | 計算ツール | Phase 3 で実装 |
| 中 | TCP の 4 ウェイクローズ、再送・輻輳制御（cwnd グラフ） | シーケンス図（＋グラフ） | Phase 3 で実装 |
| 中 | ARP | シーケンス図 | Phase 4 で実装 |
| 中 | NAT／ルーティング | 当初はトポロジ図を想定。NAT はシーケンス図と変換表、経路の検索は計算ツールにした（§8「Phase 4 の判断」） | Phase 4 で実装 |
| 低 | DHCP、ICMP（ping/traceroute） | シーケンス図 | Phase 4 で実装 |
| 低 | QUIC | シーケンス図 | Phase 5 で実装（HTTP/3 と合わせて） |
| — | HTTP のキャッシュ、CORS、HTTP/1.1 と HTTP/2 | シーケンス図 | Phase 5 で追加 |
| — | スイッチ、VLAN、IPv6 の SLAAC・近隣探索 | シーケンス図 | Phase 6 で追加 |
| — | IPv6 アドレスの表記と種類 | 計算ツール | Phase 6 で追加 |
| — | TCP のフロー制御、高速再送と SACK、パス MTU 探索 | シーケンス図 | Phase 7 で追加 |
| — | ステートフルファイアウォール、DNSSEC、メールの送信ドメイン認証（SPF・DKIM・DMARC） | シーケンス図 | Phase 8 で追加 |
| — | WebSocket | シーケンス図 | Phase 9 で追加 |
| — | NAT 越え（STUN・TURN・ICE） | シーケンス図 | Phase 10 で追加 |
| — | Wi-Fi（無線 LAN への参加、4 ウェイハンドシェイク、CSMA/CA） | シーケンス図 | Phase 11 で追加 |
| — | リバースプロキシとロードバランサー | シーケンス図 | Phase 12 で追加 |
| — | Cookie と CSRF（SameSite、トークン、Fetch Metadata） | シーケンス図 | Phase 13 で追加 |
| — | HSTS と SSL ストリッピング | シーケンス図 | Phase 14 で追加 |
| — | Server-Sent Events | シーケンス図 | Phase 15 で追加 |
| — | コンテナーのネットワーク（veth、ブリッジ、NAT） | シーケンス図 | Phase 17 で追加 |
| — | VXLAN（オーバーレイ） | シーケンス図 | Phase 18 で追加 |
| — | WireGuard（リモートアクセス VPN） | シーケンス図 | Phase 19 で追加 |

## 3. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 基盤 | React 19 + Vite + TypeScript（strict） | `any` 禁止、`as` は原則禁止（`as const` と `satisfies` は可） |
| UI | Tailwind CSS v4 + shadcn/ui | Button, Card, Tabs, Tooltip, Slider, Toggle, Collapsible, Sheet |
| ルーティング | React Router v8（宣言的モード、BrowserRouter） | `basename={import.meta.env.BASE_URL}` |
| 可視化 | SVG + Motion（旧 framer-motion） | シーケンス図は決まったレイアウトなので D3 などのレイアウトエンジンは不要。グラフ（cwnd など）もチャートライブラリを使わず素の SVG で描く |
| 多言語対応 | 自前の型安全辞書（`src/lib/i18n`） | 外部ライブラリは使わない。詳細は §5 |
| 長文コンテンツ | MDX（`@mdx-js/rollup`、Phase 2 から） | ロケールごとにファイルを分ける |
| 状態管理 | useReducer + Context | グローバルストアなし |
| 検証 | zod | URL クエリ、localStorage を検証してから型を付ける |
| テスト | Vitest + Testing Library、Playwright（Phase 3 でスモークのみ） | シナリオの導出ロジックを重点的にテスト |
| Lint | ESLint（typescript-eslint strict-type-checked）+ Prettier + dependency-cruiser | `no-explicit-any`、`consistent-type-assertions`、`react/jsx-no-literals`、循環依存・レイヤ違反の検出 |
| CI/CD | GitHub Actions（ci.yml の check → deploy）→ GitHub Pages（`actions/deploy-pages`） | PR ごとのプレビューは MVP では作らない（`vite preview` で確認） |

## 4. アーキテクチャ

### レイヤと依存の向き

```
pages → content → engine → lib
```

- `engine`: シーケンス型シナリオの汎用エンジン。`content` には依存しない
- `content`: テーマごとのシナリオ、クイズ、MDX、テーマ固有 UI
- `lib`: i18n、URL、storage などの汎用処理
- dependency-cruiser で CI 時に強制する

### エンジンの 3 層

```
シナリオ定義（データ + 純関数 buildSteps(options)）
   ↓
導出（deriveState(steps, index): 任意のステップの状態を計算する純関数）
   ↓
表示（ScenarioPlayer / SequenceDiagram / PacketInspector / ActorStatePanel / StepControls / ScenarioOptionsForm）
```

- エンジンはシーケンス型のテーマに限る。サブネット計算や OSI は別コンポーネントにする
- テーマ固有 UI（`CertChainPanel` など）は children/slot で差し込み、エンジンにテーマ固有の型を持ち込まない

### 型スケッチ

> **確定した型と仕様は [docs/design/engine.md](design/engine.md)（#26）を正とする。** 以下は計画時点のスケッチ。

```ts
// src/lib/i18n/locale.ts
export const LOCALES = ["en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l === v);

/** 翻訳対象のテキスト。全ロケール必須 */
export type LocalizedText = Readonly<Record<Locale, string>>;
```

```ts
// src/engine/types.ts
import type { LocalizedText } from "@/lib/i18n/locale";

/** 翻訳しないプロトコル用語（SYN, ClientHello, QNAME, SYN_SENT …） */
export type ProtocolTerm = string;

export const ActorKind = {
  client: "client", server: "server", resolver: "resolver",
  dnsServer: "dnsServer", ca: "ca", network: "network",
} as const;
export type ActorKind = (typeof ActorKind)[keyof typeof ActorKind];

export interface Actor {
  readonly id: string;
  readonly kind: ActorKind;
  readonly name: LocalizedText;
}

export const MessageStatus = { ok: "ok", lost: "lost", rejected: "rejected", retransmit: "retransmit" } as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export interface PacketField {
  readonly name: ProtocolTerm;          // "Flags", "Seq", "QNAME"
  readonly value: ProtocolTerm;         // "SYN", "1000", "example.com"
  readonly description: LocalizedText;
  readonly highlight?: boolean;
}

export interface Message {
  readonly id: string;
  readonly from: Actor["id"];
  readonly to: Actor["id"];
  readonly label: ProtocolTerm;
  readonly status: MessageStatus;
  readonly fields: readonly PacketField[];
}

export type StepEvent =
  | { readonly type: "message"; readonly message: Message }
  | { readonly type: "stateChange"; readonly actorId: string; readonly key: string; readonly value: ProtocolTerm }
  | { readonly type: "note"; readonly actorId: string; readonly text: LocalizedText }
  | { readonly type: "timer"; readonly actorId: string; readonly label: LocalizedText; readonly ms: number };

export interface Step {
  readonly id: string;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly events: readonly StepEvent[];
}

export type ScenarioOptionDef =
  | { readonly kind: "toggle"; readonly key: string; readonly label: LocalizedText; readonly defaultValue: boolean }
  | {
      readonly kind: "select"; readonly key: string; readonly label: LocalizedText;
      readonly choices: readonly { readonly value: string; readonly label: LocalizedText }[];
      readonly defaultValue: string;
    };

export interface Scenario<TOptions extends Record<string, string | boolean>> {
  readonly id: string;
  readonly title: LocalizedText;
  readonly actors: readonly Actor[];
  readonly optionDefs: readonly ScenarioOptionDef[];
  readonly defaultOptions: TOptions;
  readonly parseOptions: (raw: unknown) => TOptions;           // zod で URL クエリを検証
  readonly buildSteps: (options: TOptions) => readonly Step[]; // 純関数・ロケール非依存
}
```

```ts
// src/engine/player.ts
export const PlayerStatus = { idle: "idle", playing: "playing", paused: "paused", finished: "finished" } as const;
export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];

export interface PlayerState {
  readonly stepIndex: number;
  readonly status: PlayerStatus;
  readonly speed: 0.5 | 1 | 2;
  readonly selectedMessageId: string | null;
}

export type PlayerAction =
  | { readonly type: "next" } | { readonly type: "prev" } | { readonly type: "jump"; readonly index: number }
  | { readonly type: "play" } | { readonly type: "pause" } | { readonly type: "reset" }
  | { readonly type: "setSpeed"; readonly speed: PlayerState["speed"] }
  | { readonly type: "selectMessage"; readonly id: string | null };
```

## 5. 多言語対応（en / ja）

### URL

- ロケールは常にパスの先頭に置く（例: `/NetworkStudy/ja/themes/tcp-handshake?step=3`）。デフォルト言語でも省略しない
- `/`、プレフィックスのないパス、不正なロケールのパスは、すべて `LocaleRedirect` でリダイレクトする。ロケールの優先順は localStorage（`ns.locale`）→ `navigator.languages`（`ja*` なら `ja`）→ `en`
- 先頭のセグメントが言語タグらしい形（`fr`、`ja-JP` など）なら差し替え、そうでなければ（`themes` など）先頭にロケールを付け足す。クエリとハッシュは保持する
- 言語切替では、パス先頭のロケールだけを置き換え、クエリ（`?step=…`）はそのまま残す
- 進捗のキーにはロケールを含めない（言語を切り替えても進捗は共有される）

```tsx
<Routes>
  <Route index element={<LocaleRedirect />} />
  {/* 先頭セグメントが対応ロケールでなければ LocaleLayout が LocaleRedirect を返す */}
  <Route path=":locale" element={<LocaleLayout />}>  {/* 検証 + LocaleProvider + <html lang> 同期 */}
    <Route index element={<HomePage />} />
    <Route path="themes/:theme" element={<ThemePage />} />  {/* Phase 1 で追加 */}
    <Route path="*" element={<NotFoundPage />} />
  </Route>
</Routes>
```

### UI 文言の辞書

キーを文字列で指定せず、オブジェクトのプロパティとして参照する。`satisfies` を使うことで、キーの欠落・余剰や関数シグネチャの不一致がコンパイルエラーになる。

```ts
// src/lib/i18n/messages/en.ts（英語版を正とする。as const を付けると ja が代入できないため付けない）
export const en = {
  stepper: {
    counter: (p: { current: number; total: number }) => `Step ${p.current} of ${p.total}`,
    next: "Next",
    prev: "Back",
  },
};
export type Messages = DeepReadonly<typeof en>;  // 書き換えは型で禁止する

// src/lib/i18n/messages/ja.ts
export const ja = {
  stepper: {
    counter: (p) => `ステップ ${p.current} / ${p.total}`,
    next: "次へ",
    prev: "戻る",
  },
} satisfies Messages;
```

- `useLocale()` / `useMessages()` / `useText()`（`LocalizedText` を現在のロケールで解決する関数を返す）を提供する
- 数値や日付は `Intl.*` のラッパーを `lib/i18n/format.ts` にまとめる

### シナリオ・クイズのテキスト

- `LocalizedText` をデータに直接埋め込む。`buildSteps` にはロケールを渡さない（純関数のまま）
- **型が `LocalizedText` なら翻訳する、`ProtocolTerm` なら翻訳しない**、というルールで区別する
- 長文で `scenario.ts` が肥大化したら、テキストを `scenario.text.ts` に切り出す
- テストでは `buildSteps(defaults)[0].title.en` のように直接アサートする

### MDX（Phase 2〜）

- `overview.en.mdx` と `overview.ja.mdx` のようにロケールごとにファイルを分ける
- `ThemeModule.overview: Record<Locale, () => Promise<MDXModule>>` とし、どちらかが欠けたら型エラーにする
- 言語に依存しない図などの部品は `overview.parts.tsx` に切り出して共有する

### 翻訳漏れの検出

| 層 | 手段 |
|---|---|
| 型 | `LocalizedText`、`satisfies Messages`、`Record<Locale, …>` |
| テスト | registry の全シナリオとクイズを走査し、すべての `LocalizedText` が空でなく、`TODO` を含まないことを検証する |
| テスト | ページを en / ja でレンダリングするスモークテスト |
| Lint | `react/jsx-no-literals` で JSX への文字列の直書きを禁止する |

## 6. GitHub Pages 対応

- `vite.config.ts` に `base: "/NetworkStudy/"` を設定する
- **直リンク対策**: ビルド後に `scripts/generate-static-pages.ts` で、ロケール × テーマの組み合わせごとに `dist/{en,ja}/index.html` と `dist/{en,ja}/themes/<id>/index.html` を複製する。どの URL も 200 で返るため、検索エンジンにも拾われる
- 複製時に `<html lang>`、`<title>`、`description`、`canonical`、`hreflang`（en / ja / x-default）を埋め込む。OG メタと Twitter カード、sitemap.xml も生成する（#66）
- ロケールなしのページ（`/`、`/themes/<id>/`）もルートごとに生成する（x-default の参照先。SPA がロケール付きの URL へリダイレクトする）
- 未知のパス用に `404.html` も置く（中身は SPA のエントリと同じ）
- デプロイは ci.yml の deploy job で行う。main への push のとき、check job（検証・ビルド）が通った後にだけ実行する

## 7. ディレクトリ構成

```
NetworkStudy/
├── .github/
│   ├── workflows/ci.yml        # check（検証・ビルド）→ deploy（main のみ）
│   ├── ISSUE_TEMPLATE/ (design.md, enhancement.md, bug.md)
│   └── pull_request_template.md
├── docs/ (PLAN.md, glossary.md)
├── public/
├── scripts/                     # generate-static-pages.ts, verify-static-pages.ts, static-pages/（純関数）
├── src/
│   ├── main.tsx
│   ├── app/ (AppRoutes.tsx, LocaleLayout.tsx, LocaleRedirect.tsx)
│   ├── components/
│   │   ├── ui/                 # shadcn
│   │   ├── layout/             # AppLayout, Header, Footer, LanguageSwitcher（Sidebar はテーマ追加時）
│   │   └── features/ (quiz/, progress/, theme-card/)
│   ├── engine/
│   │   ├── types.ts
│   │   ├── derive.ts / derive.test.ts
│   │   ├── player.ts / player.test.ts
│   │   ├── hooks/ (useScenarioPlayer.ts, useScenarioUrlState.ts)
│   │   └── ui/ (ScenarioPlayer, SequenceDiagram, PacketInspector, ActorStatePanel, StepControls, ScenarioOptionsForm)
│   ├── content/
│   │   ├── registry.ts
│   │   ├── types.ts            # ThemeModule
│   │   ├── tcp-handshake/ (index.ts, scenario.ts, scenario.test.ts, quiz.ts, overview.{en,ja}.mdx)
│   │   ├── dns-resolution/
│   │   └── tls-handshake/ (+ CertChainPanel.tsx)
│   ├── pages/ (HomePage, ThemePage, NotFoundPage, AboutPage)
│   ├── hooks/
│   ├── lib/ (i18n/, url.ts, storage.ts, utils.ts)
│   └── types/ (mdx.d.ts)
├── .dependency-cruiser.cjs
├── eslint.config.js
├── vite.config.ts / vitest.config.ts / tsconfig*.json
├── CLAUDE.md
├── LICENSE
└── README.md
```

## 8. ロードマップ

ラベルは `design` / `enhancement` / `bug` / `infra` / `content` / `engine` / `i18n` / `theme:tcp` / `theme:dns` / `theme:tls` / `accessibility` / `phase:0`〜`phase:6`。

### Phase 0: 環境構築

**完了条件**: CI が通り、`/en/` と `/ja/` の Hello ページが GitHub Pages に自動デプロイされる。

| # | タスク | ラベル |
|---|---|---|
| 0-1 | ラベル、Issue／PR テンプレート、main のブランチ保護（CI 必須） | infra |
| 0-2 | Vite + React 19 + TypeScript strict の雛形、`@/` エイリアス | infra |
| 0-3 | Tailwind v4 と shadcn/ui の初期化 | infra |
| 0-4 | ESLint（strict-type-checked, jsx-no-literals）、Prettier、dependency-cruiser | infra |
| 0-5 | Vitest と Testing Library のセットアップ | infra |
| 0-6 | i18n 基盤（`Locale`、`LocalizedText`、辞書、`useMessages`／`useText`）とテスト | i18n |
| 0-7 | ロケール付きルーティング、`LocaleRedirect`、`LanguageSwitcher`、AppLayout、Home／NotFound | i18n, enhancement |
| 0-8 | GitHub Actions の CI（typecheck／lint／test／build） | infra |
| 0-9 | GitHub Pages へのデプロイ（base 設定、静的ページ生成スクリプト、hreflang、404.html） | infra, i18n |
| 0-10 | CLAUDE.md（規約、レイヤ依存ルール） | infra |

### Phase 1: エンジン + TCP

**完了条件**: TCP テーマが正常な流れ・3 つの分岐・クイズまで en／ja で動き、URL を共有すると同じステップが再現される。導出ロジックには単体テストがある。

| # | タスク | ラベル |
|---|---|---|
| 1-1 | エンジンの型を確定する（§4 のレビュー） | design, engine |
| 1-2 | `types.ts`、`derive.ts` とテスト | engine |
| 1-3 | `player.ts` の reducer、`useScenarioPlayer`、自動再生とテスト | engine |
| 1-4 | `SequenceDiagram` の静的描画（ライフライン、矢印、lost／rejected の表現） | engine |
| 1-5 | `SequenceDiagram` のアニメーションとレスポンシブ対応 | engine |
| 1-6 | `StepControls`、`StepDescription`、キーボード操作 | engine |
| 1-7 | `PacketInspector` | engine |
| 1-8 | `ActorStatePanel` | engine |
| 1-9 | `ScenarioOptionsForm` と URL の同期（zod で検証） | engine |
| 1-10 | TCP シナリオの正常な流れ（en／ja）とテスト | theme:tcp |
| 1-11 | TCP の What-if 3 種 | theme:tcp |
| 1-12 | `QuizPanel` と `useQuizProgress`（localStorage、zod） | enhancement |
| 1-13 | TCP のクイズ、ThemePage、registry への登録 | theme:tcp, content |
| 1-14 | 翻訳の網羅テスト（registry の走査、en／ja のスモーク） | i18n |
| 1-15 | 内容の正確性レビュー（RFC 9293 との照合） | content |

### Phase 2: DNS・TLS + MDX

**完了条件**: 3 テーマすべてにトップページから到達でき、それぞれにクイズと 2 種類以上の What-if、en／ja の概要 MDX がある。

| # | タスク | ラベル |
|---|---|---|
| 2-1 | MDX の導入（ロケール別の読み込み、型宣言） | infra, i18n |
| 2-2 | DNS シナリオ（5 アクター）とテスト | theme:dns |
| 2-3 | DNS の What-if（キャッシュヒット、NXDOMAIN、CNAME、タイムアウト） | theme:dns |
| 2-4 | リゾルバのキャッシュ表の表示 | theme:dns, engine |
| 2-5 | DNS のクイズ、概要、ページ | theme:dns |
| 2-6 | TLS 1.3 シナリオ（暗号化済み区間の表現）とテスト | theme:tls |
| 2-7 | `CertChainPanel` | theme:tls |
| 2-8 | TLS の What-if（期限切れ、SAN 不一致、未知の CA、中間証明書の欠落） | theme:tls |
| 2-9 | TLS のクイズ、概要、ページ | theme:tls |
| 2-10 | ポータルのトップページ（テーマカード、推奨学習順、進捗表示） | enhancement |
| 2-11 | ダークモードとアクセシビリティ（色以外でも lost を表現、aria-label） | enhancement |
| 2-12 | SEO の仕上げ（言語別の OG、hreflang の検証） | i18n |

### Phase 3: 品質・拡張

**完了条件**: Lighthouse のアクセシビリティが 90 以上、Playwright のスモークテストがあり、テーマが 1 つ以上増えている。

**完了**（#76〜#91）: Lighthouse は全ページでアクセシビリティ 100（CI でも 90 以上を確認）、Playwright のスモークテストと axe のチェックを CI で実行、テーマは 3 → 8（OSI 参照モデル、サブネット計算、HTTPS の全体像、TCP の接続の終了、TCP の輻輳制御）。ホームとサイドバーは分類（ネットワークの基礎／Web のページが届くまで／TCP をもっと詳しく）ごとに分けた。

| # | タスク | ラベル |
|---|---|---|
| 3-1 | Playwright のスモークテスト（各テーマ × 各ロケールで最終ステップまで進める） | infra |
| 3-2 | 用語集 `docs/glossary.md`（訳語の統一、翻訳しない用語の一覧） | i18n, content |
| 3-3 | HTTPS の全体像（シナリオを合成するヘルパー） | content |
| 3-4 | OSI の積み上げアニメーション | content |
| 3-5 | サブネット計算ツール | content |
| 3-6 | トポロジ系で React Flow を導入するか判断する | design |
| 3-7 | TCP の 4 ウェイクローズ、再送・輻輳制御 | theme:tcp |

Issue は #76〜#91 に分けて起票した（3-3 はヘルパーとテーマ、3-5 は計算の関数と UI、3-7 は 4 ウェイクローズと輻輳制御をそれぞれ別のテーマにする）。

#### Phase 3 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| React Flow（3-6） | Phase 3 では導入しない | Phase 3 のテーマ（HTTPS はシーケンス図、OSI は縦の積み上げ、サブネットはフォーム、cwnd は折れ線）は、どれも自動レイアウトやドラッグ編集を必要としない。依存が増え、型の扱い（`as` 禁止、`exactOptionalPropertyTypes`）の確認も要る。NAT／ルーティングに着手するときに「ノード数が動的か（利用者が追加するか）」「ドラッグで編集するか」で判断し直す。固定のトポロジ（3〜5 ノード）なら SVG + Motion で描く |
| cwnd のグラフ | 素の SVG | 点は 10〜15 個、系列は cwnd と ssthresh の 2 本だけ。チャートライブラリは型の扱いが重く、バンドルも増える |
| シーケンス図以外のテーマ | `ThemeModule` を `kind`（`sequence` / `custom`）で判別する共用体にする | OSI とサブネット計算はシナリオを持たない。クイズと概要はどの kind でも必須にし、ホームの進捗と説明の形をそろえる |
| HTTPS の全体像 | 既存の 3 シナリオと小さな HTTP のパートを合成する。What-if は v1 では出さない | オプションを全部出すと組み合わせが DNS × TCP × TLS の積になり、フォームも長くなる。帯はパート名（1. 名前解決〜4. リクエスト）にする |
| OSI | OSI の 7 層を主にし、TCP/IP の 4 層は対応表で示す。例は HTTP GET over TCP / IPv4 / Ethernet | 資格試験（基本情報など）の出題に合わせる |
| サブネット計算 | IPv4 のみ。クイズも付ける | 対象の学習者に必要な範囲。IPv6 は扱わない |
| TCP の 4 ウェイクローズ・輻輳制御 | 別のテーマ（`tcp-close`、`tcp-congestion`）にする。輻輳制御は Reno 相当（RFC 5681）に限る。どちらも難易度は中級 | 既存の TCP テーマの分岐にすると、オプションとステップ数が増えすぎる。CUBIC などは概要で触れるだけにする |
| 用語集 | 開発者向けの `docs/glossary.md` だけにする（利用者向けのページは作らない） | 訳語をそろえるのが目的 |
| ホームの構成 | テーマが増えたら、分類（実装ではネットワークの基礎／Web のページが届くまで／TCP をもっと詳しく）ごとに分ける | 一列の学習順では 8 テーマを案内しにくい |
| CI | e2e（Playwright と axe）と Lighthouse CI は `Check` job のステップにする。Lighthouse はアクセシビリティだけを error にする | 必須チェックの設定を変えずに済む。パフォーマンスは CI では値がぶれる |

### Phase 4: ネットワークにつながるまで

**完了条件**: 分類「ネットワークにつながるまで」（`ip`）に、PC がネットワークにつながってからパケットがルーターを越えるまでの 5 テーマがあり、どれにも根拠の RFC、クイズ、en／ja の概要がある。

**完了**（#108〜#117）: テーマは 8 → 13（ARP、DHCP、ICMP、NAT、経路の検索）。分類は「ネットワークの基礎」の次に置いた。

| # | タスク | ラベル |
|---|---|---|
| 4-1 | ARP のシナリオ（`ActorKind` に `router` を追加）、ページ、分類 `ip` | engine, content |
| 4-2 | DHCP のシナリオ（DORA、更新、再起動、DHCPNAK）とページ | content |
| 4-3 | ICMP（ping / traceroute）のシナリオとページ | content |
| 4-4 | NAT／NAPT のシナリオとページ | content |
| 4-5 | 経路の検索（最長一致）の純関数と UI | content |
| 4-6 | README、PLAN、用語集の仕上げ | content |

Issue は #108〜#117 に分けて起票した（4-1〜4-3 と 4-5 は、シナリオや純関数とページを別の Issue にする）。

#### Phase 4 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類の位置 | 「ネットワークの基礎」と「Web のページが届くまで」の間 | OSI とサブネットの次に学び、Web の前提になる。テーマの順は ARP → DHCP → ICMP → NAT → 経路の検索（ARP は DHCP の説明にも出てくるので先にする） |
| アクターの種類 | `ActorKind` に `router` を足す | ARP・DHCP・ICMP・NAT ではルーター（DHCP のサーバーを兼ねる）が主役になり、クライアントともサーバーとも役割が違う。アクターの役割を型で正しく表すため |
| アドレスの割り当て | 5 テーマで同じ機器には同じアドレスを使う（PC 192.168.1.10、ルーター 192.168.1.1 / 203.0.113.5、サーバー 192.0.2.10）。グローバルは文書用のアドレス（RFC 5737）、MAC は文書用の範囲（RFC 9542） | テーマをまたいで同じ機器だとわかる。実在の機器と衝突しない |
| DHCP のリース期間 | 3600 秒（T1 1800 秒、T2 3150 秒） | 更新の時刻が読みやすい切りのよい値。T1 / T2 は RFC 2131 §4.4.5 の既定（リースの 0.5、0.875） |
| ICMP と NAT | ICMP のテーマでは NAT を省く（概要とステップの注記で説明する） | 変換を入れると、TTL とアドレスの読み取りという主題がぼやける。NAT は別のテーマで扱う |
| NAT の見せ方 | トポロジ図ではなく、シーケンス図とルーターの変換表（状態パネル）。NAPT のみ | 既存のエンジンで、書き換え前後のアドレスとポートをパケットごとに見せられる。React Flow は引き続き導入しない |
| 経路の検索 | `custom` の計算ツール。経路表は 2 つのプリセット（家庭のルーター、PC）で、編集はできず、経路ごとに無効にできるだけ | 経路を自由に入力させると検証と UI が重くなる。無効にするだけで、最長一致・メトリック・デフォルト経路・経路なしを試せる |
| 同じ長さ・同じメトリックの経路 | 表で先の経路を選ぶ（ツールの単純化として明記） | ECMP や管理距離は扱わない |

### Phase 5: Web 開発で出会う HTTP

**完了条件**: 分類「Web 開発で出会う HTTP」（`http`）に、Web 開発者が実務で出会う HTTP のしくみの 4 テーマがあり、どれにも根拠（RFC または Fetch Standard）、クイズ、en／ja の概要がある。画面に色を使い、分類・難易度・アクターを色でも見分けられる。

**完了**（#128、#130〜#139、#147）: テーマは 13 → 17（HTTP のキャッシュ、CORS、HTTP/1.1 と HTTP/2、QUIC と HTTP/3）。配色（ブランドの青、6 つの色相、成功の緑）を入れ、分類はホームの見出しの帯、テーマのカードの縁と番号、サイドバーの印、難易度はバッジ、アクターは図の見出しとライフラインの色で示す。

| # | タスク | ラベル |
|---|---|---|
| 5-0 | 配色の導入（トークン、分類・難易度・アクターの色）と 6 つ目の色相 `rose` | design, enhancement |
| 5-1 | HTTP のキャッシュ（Cache-Control / ETag / 304）と分類 `http` | content |
| 5-2 | CORS（プリフライト）のシナリオとページ | content |
| 5-3 | HTTP/1.1 と HTTP/2 のシナリオとページ | content |
| 5-4 | QUIC / HTTP/3 のシナリオとページ | content |
| 5-5 | シーケンス図の長いラベルが SVG の端で切れる問題の修正 | bug, engine |
| 5-6 | README、PLAN、CLAUDE.md、用語集の仕上げ | content |

Issue は #128（配色）、#130〜#139、#147 に分けて起票した。#138（ストリームの色分け、`Message.group`）は、HTTP/2 の図がラベルの `[stream N]` で十分に読めたので見送った。

#### Phase 5 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 配色 | shadcn の無彩色に、ブランドの青（`--primary`・`--accent`・`--ring`）、成功の緑（`--success`）、6 つの色相（`--tone-*` と `-soft`）を足す。色だけで意味を伝えず、記号と文字を残す | 単調な画面を改める。明暗の両方で WCAG 2.1 AA（本文 4.5:1）を満たす値を計算で決め、axe と Lighthouse で確かめる |
| 色の対応の置き場所 | 色相とクラスは `lib/tone.ts`、分類と難易度は `content/themeTone.ts`、アクターの種類は `engine/ui/actorTone.ts` | レイヤの向き（engine は content に依存しない）を守る。`themeMeta.ts` は scripts から読むので表示だけの対応を入れない |
| 分類 | 新しい分類 `http`「Web 開発で出会う HTTP」を末尾（`tcp` の後）に置く。色は `rose` | `web` に足すと 8 テーマになる。HTTP/2 の HOL ブロッキングと QUIC のロスは、TCP の再送の知識を前提にする。既存のカードの位置を動かさない |
| テーマの順 | キャッシュ → CORS → HTTP/1.1 と HTTP/2 → QUIC | HTTP の意味論（初級）から、トランスポートの進化（中級）へ |
| HTTP の描き方 | HTTP/1.1 はテキスト、HTTP/2 と HTTP/3 はフレームで描き、暗号化せずに描く（QUIC は暗号化レベルを示す） | ヘッダーが主題。「実際は HTTPS の上」と注記する |
| 状態の値 | 状態パネルの値は、翻訳しないプロトコルの用語（`hit (fresh)`、`1 segment missing` など）にする | 状態の値は `ProtocolTerm` で、日本語の画面でもそのまま出る。説明の文はステップの解説に書く |
| キャッシュ | ブラウザーのプライベートキャッシュだけ。検証子は ETag のみ。`max-age=60` の満了はタイマーで見せる | 共有キャッシュ・CDN は別のテーマ候補 |
| CORS の根拠 | Fetch Standard（WHATWG）を節の名前・アンカー・参照日で引き、RFC 6454 と RFC 9110 §9.3.7 を添える | RFC がない。Living Standard は節番号が動く |
| CORS のアクター | ページのスクリプト／ブラウザー／API サーバーの 3 つ | CORS を強制するのはブラウザーで、サーバーは要求を処理している、を図で見せる |
| HTTP/2 の粒度 | 1 メッセージ = 1 フレーム（最大 16,384 バイト）。ロスは RTO 1 秒で再送し、HOL ブロッキングは TCP の受信バッファーの状態で示す | `MessageStatus` を増やさずに表せる |
| QUIC の粒度 | 1 メッセージ = 1 QUIC パケット。暗号化レベルはフィールドと `encrypted`、パケット番号の空間は表、区間はフェーズ。図のラベルは短くし、フレームの全体はインスペクタに出す | 1 つのデータグラムに複数のレベルのパケットが入る。2 レーンの図にラベルを収める |
| QUIC と HTTP/3 | 1 テーマにまとめる。QPACK、制御ストリーム、Retry、輻輳制御は概要だけ | 主題は 1-RTT、0-RTT、ロス |
| 図のラベルの幅 | レーンの幅を、ラベルが SVG の端で切れない幅まで広げる（はみ出す分は横スクロール） | アクターが少ない図や狭い画面でラベルが読めなかった |

### Phase 6: LAN の中

**完了条件**: 新しい分類「LAN の中」（`lan`）に、スイッチ・VLAN・IPv6 の近隣探索のテーマがあり、「ネットワークの基礎」に IPv6 アドレスのツールがある。どれにも根拠（RFC または IEEE の規格）、クイズ、en／ja の概要がある。

**完了**（#150〜#158）: テーマは 17 → 21（スイッチ、VLAN、IPv6 の SLAAC・近隣探索、IPv6 アドレス）。`ActorKind` に `switch` を足した。

| # | タスク | ラベル |
|---|---|---|
| 6-1 | スイッチの MAC アドレス学習のシナリオ（`ActorKind` に `switch`）とページ、分類 `lan` | engine, content |
| 6-2 | VLAN のシナリオ（802.1Q タグ、トランク、ルーター経由）とページ | content |
| 6-3 | IPv6 アドレスの純関数（RFC 5952 の表記、種類、EUI-64、要請ノードマルチキャスト）とツール | content, accessibility |
| 6-4 | IPv6 の SLAAC・近隣探索のシナリオとページ | content |
| 6-5 | README、PLAN、CLAUDE.md、用語集の仕上げ | content |

Issue は #150〜#158 に分けて起票した（どのテーマも、シナリオや純関数とページを別の Issue にする）。

#### Phase 6 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類 | 新しい分類 `lan`「LAN の中」を `ip` の次に置く。色は `green` | `ip` に 3 テーマを足すと 8 テーマになる。ARP と DHCP を学んでから読む内容。空いている色相は緑だけで、`tcp` の紫が中級のバッジと同じ色である前例に従う |
| IPv6 アドレスのツールの分類 | `basics`（サブネット計算の次） | リンクの中の話ではなく、アドレスの表記と種類の基礎。サブネット計算と同じ形の計算ツール |
| アクターの種類 | `ActorKind` に `switch` を足し、色は `rose` | VLAN の図でルーターと並ぶので `router` は使えない。`rose` はどの種類にも使われていない |
| IEEE の引用 | シナリオのコメントでは規格名・年・節の題名で引く（IEEE Std 802.1Q-2022）。概要では IEEE GET Program（登録すると無料）と IEEE SA のページにリンクする。エージングの既定 300 秒は RFC 4188 でも裏付ける | RFC のように本文へ直接リンクできない |
| フラッディングとマルチキャストの描き方 | 同じステップで、届く先のレーンごとに 1 本のメッセージ。受け取って処理する機器は `delivered`、捨てる機器は `rejected`。届かないポートには描かず、スイッチの状態で示す | ARP のブロードキャストと同じ描き方。エンジンに宛先のグループを足さない |
| VLAN の図 | ルーターはトランクのサブインターフェース（1 本のトランクでつないだルーター）。VLAN ID は 10 と 20 | VLAN ID には説明用の範囲がない。L3 スイッチは概要で触れる |
| IPv6 のアドレス | 2001:db8:1::/64 と、MAC アドレスからの EUI-64 | RFC 3849 の文書用。MAC から導けるので追いやすい。実際の OS はランダムな ID を使うと注記する |
| アドレス解決の例 | PC 2（ルーターではなく） | RA の送信元リンク層アドレスで、ルーターの MAC アドレスはすでにわかる（RFC 4861 §6.3.4） |
| 長い値の折り返し | クイズの問題と選択肢は、どこでも折り返せるようにする（`wrap-anywhere`） | IPv6 アドレスのような長い語が、狭い画面ではみ出した |
| 扱わないもの | STP、L3 スイッチ、MLD とスヌーピング、DHCPv6、一時アドレス、NUD の DELAY / PROBE | 主題がぼやける。概要で触れる |

### Phase 7: TCP の深掘りとパス MTU

**完了条件**: 「TCP をもっと詳しく」（`tcp`）にフロー制御と高速再送・SACK のテーマがあり、「ネットワークにつながるまで」（`ip`）にパス MTU 探索のテーマがある。どれにも根拠の RFC、クイズ、en／ja の概要がある。

**完了**（#168〜#174）: テーマは 21 → 24（TCP のフロー制御、高速再送と SACK、パス MTU 探索）。エンジンの変更はない。

| # | タスク | ラベル |
|---|---|---|
| 7-1 | TCP のフロー制御のシナリオ（受信ウィンドウ、ゼロウィンドウとプローブ、受信側の SWS 回避）とページ | content |
| 7-2 | 高速再送と SACK のシナリオ（重複 ACK、SACK のブロックとスコアボード、NewReno の部分的な確認応答、末尾のロス）とページ | content |
| 7-3 | パス MTU 探索のシナリオ（DF と Fragmentation Needed、ブラックホール、フラグメント化）とページ | content |
| 7-4 | README、PLAN、CLAUDE.md、用語集の仕上げ | content |

Issue は #168〜#174 に分けて起票した（どのテーマも、シナリオとページを別の Issue にする）。

#### Phase 7 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類 | フロー制御と SACK は `tcp`（輻輳制御の次）、パス MTU 探索は `ip`（ICMP の次） | パス MTU 探索は ICMP と IP のヘッダーの話で、ICMP のテーマを読んでから読む内容 |
| 数値 | MSS は 1000 バイト（パス MTU 探索だけは実際の 1460）、ISS は 3 ウェイハンドシェイクと同じ（データは 1001 から）、RTO は 1 秒から倍 | 1000 の倍数で seq と ack を追いやすい。パス MTU 探索は 1500 と 1492 の差そのものが主題 |
| フロー制御の単純化 | 遅延 ACK は 2 セグメントごと、プローブは 1 バイトの新しいデータ。受け入れられなかったプローブでは SND.NXT を進めない | 使えるウィンドウの式を毎ステップで確かめられるようにする。実際の動きはシナリオのコメントに書く |
| SACK の比較 | 同じ 2 つのロスを、SACK ありと累積の確認応答だけ（NewReno）で比べる。再送するセグメントは RFC 6675 §4 の IsLost（NextSeg の規則 (1)）で決める | 「1 往復に 1 つの抜け」の差がそのまま見える。cwnd は輻輳制御のテーマに任せ、pipe は扱わない |
| 末尾のロス | 7 つの ACK を 1 本のメッセージにまとめ、RTO で再送する。RACK-TLP は文章で触れる | 重複 ACK が来ないことが主題。TLP を描くと RFC 8985 の説明が必要になる |
| パス MTU の経路 | PC → 家庭のルーター（WAN は PPPoE、MTU 1492）→ サーバー。ルーター自身が ICMP を返す | 家庭で実際に起きる構成で、ルーターが 1 台で済む。NAT は描かない（NAT のテーマを参照） |
| ブラックホール | ICMP は途中のファイアウォールで `lost`。RTO 1 秒と 2 秒の再送を描いて止める | 「ハンドシェイクは通るのに止まる」症状を見せる。対策（MSS clamping、PLPMTUD）は文章で触れる |
| 扱わないもの | Window Scale、送信側の SWS 回避（Nagle）、RACK、PLPMTUD、IPv6 の Packet Too Big | 主題がぼやける。概要で触れる |

### Phase 8: ネットワークのセキュリティ

**完了条件**: 新しい分類「ネットワークのセキュリティ」（`security`）に、ステートフルファイアウォール、DNSSEC、メールの送信ドメイン認証のテーマがある。どれにも根拠の RFC、クイズ、en／ja の概要がある。

**完了**（#182〜#188）: テーマは 24 → 27（ステートフルファイアウォール、DNSSEC、メールの送信ドメイン認証）。7 つ目の色相 `orange` を足した。エンジンの変更はない。

| # | タスク | ラベル |
|---|---|---|
| 8-1 | ステートフルファイアウォールのシナリオ（接続の追跡、UDP のタイムアウト、RELATED の ICMP、drop と reject）とページ、分類 `security`、色相 `orange` | content, design |
| 8-2 | DNSSEC の検証のシナリオ（トラストアンカー、DS・DNSKEY・RRSIG、AD、Insecure、Bogus と SERVFAIL、CD）とページ | content |
| 8-3 | メールの送信ドメイン認証のシナリオ（SPF、DKIM、DMARC、なりすまし、転送、メーリングリスト）とページ | content |
| 8-4 | README、PLAN、CLAUDE.md、用語集の仕上げ | content |

Issue は #182〜#188 に分けて起票した（どのテーマも、シナリオとページを別の Issue にする）。

#### Phase 8 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類 | 新しい分類 `security`「ネットワークのセキュリティ」を `http` の次（最後）に置く。順はファイアウォール → DNSSEC → メール | どの既存の分類にも収まらない。DNS、TCP、TLS を学んでから読む内容。ファイアウォールは TCP・UDP・ICMP の知識をそのまま使い、メールは SMTP と 3 回の DNS の問い合わせと署名を組み合わせるので最後 |
| 色相 | 7 つ目の `orange`（明: oklch(0.5 0.14 45)、暗: oklch(0.8 0.12 55)） | 6 つの色相はどれも使われている。amber と rose の間の色相で、明暗とも 4.5:1 以上。分類の見出しは必ず文字も出すので、amber との近さは問題にならない |
| アクターの種類 | 新しい種類は足さない。ファイアウォールは `router`、メールサーバーは `server`、DNS は `resolver` / `nameServer` | 同じ図にルーターとファイアウォールが並ぶことはない。同じ種類のレーンが 2 つ以上ある図は前例がある |
| ファイアウォールの構成 | NAT なし（文書用のアドレスをそのまま経路に乗るものとして使う）。ルールは 3 つ。状態の名前は netfilter の NEW / ESTABLISHED / RELATED | NAT のテーマと混ざらない。RFC 6092（IPv6 の CPE）のモデルと同じ。家庭のルーターは NAT と組み合わせると注記する |
| ルール 3 の選択肢 | drop / reject の 2 択（設計の「頼んでいない SYN が来ない」はなくした）。reject は TCP に RST, ACK、UDP に ICMP の Port Unreachable | reject のとき、遅れて来た UDP の応答にも一貫して答えられる |
| RST の後のエントリー | 「すぐに消える」とは書かない（Linux は 10 秒残し、RFC 7857 は NAT に 4 分待つよう求める） | RST は偽造されうる。レビューの指摘 |
| DNSSEC の鍵 | 架空の key tag とダイジェスト、アルゴリズムはどれも 13。検証の日時は 2026-10-01（TLS のテーマと同じ） | 本物のルートの KSK を埋め込まない。RFC 9904（RFC 8624 を置き換えた）で 13 は署名に推奨 |
| 署名のない委任 | NSEC3 を 2 つ（com. そのものと、example.com を覆う Opt-Out）で証明する | RFC 5155 §7.2.7 は最も近い上位の名前の証明を求める。レビューの指摘 |
| CD | 検証してから、結果にかかわらずデータを返す。検証できたときは AD も立てる（CD のときは検証しない実装もあると注記） | RFC 4035 §3.2.2 はどちらも許す |
| DMARC の根拠 | RFC 9989（2026 年 5 月。RFC 7489 を置き換えた）と RFC 9990 / 9991 | pct や PSL など RFC 7489 だけの概念は使わない |
| p=reject | 受信側は 550 5.7.1 で拒否するが、RFC 9989 §7.4 が p=reject だけを理由にした拒否を禁じ、quarantine として扱うよう求めていることを文章で示す | 実際には拒否が多い。学ぶ人が RFC の求めを取り違えないように |
| メールの状態の値 | pass / fail、accept / quarantine / reject など短い語だけにする | 状態の値は翻訳しない（ProtocolTerm）。レビューの指摘 |
| 扱わないもの | ファイアウォールの INVALID と TCP の順序の追跡、NSEC / NSEC3 による NXDOMAIN の不在証明、DNSSEC のキャッシュ、DKIM の l= / i= / x= と複数の署名、DMARC の sp / np / t / 失敗レポート / ツリーウォーク、SRS、STARTTLS / MTA-STS / DANE / BIMI | 主題がぼやける。一部は概要で触れる |

### Phase 9: WebSocket

**完了条件**: 「Web 開発で出会う HTTP」（`http`）に WebSocket のテーマがあり、根拠の RFC、クイズ、en／ja の概要がある。

**完了**（#200〜#202）: テーマは 27 → 28（WebSocket）。エンジンの変更はない。フレームのバイト列を作る純関数（`src/content/websocket/frame.ts`）を足した。

| # | タスク | ラベル |
|---|---|---|
| 9-1 | WebSocket のシナリオ（開始のハンドシェイクと Sec-WebSocket-Accept、マスク、長さの 7 / 16 / 64 ビット、フラグメント、Ping / Pong、終了のハンドシェイク。もしも: 誤った Accept、Pong が返らない。フラグメントは別の切り替え）とテスト | content |
| 9-2 | WebSocket のページ（概要、クイズ、登録） | content |
| 9-3 | PLAN、CLAUDE.md、README、用語集の仕上げ | content |

Issue は #200〜#202 に分けて起票した。

#### Phase 9 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `http` の QUIC の次 | HTTP/1.1 の Upgrade と TCP の終了の上に立つ。Web 開発で出会う技術 |
| アクター | ブラウザー（`client`）とサーバー（`server`）の 2 つ。プロキシは描かない | 線の上のバイト列は変わらない。プロキシとマスクの関係は概要で説明する |
| キーとマスクキー | RFC 6455 §1.3 のキーと §5.7 のマスクキー、ほかは例の値 | RFC と照らして確かめられる。本当は乱数だと、フィールドの説明と概要に書く |
| バイト列 | ヘッダーとマスクは純関数で作り、RFC 6455 §5.7 の例をすべて再現するテストで固定する | 手で書いた 16 進の値の誤りを防ぐ |
| Ping を送る側 | サーバー（ブラウザーは自動で Pong を返す） | WHATWG の API には ping() がない |
| Ping の間隔と Pong の待ち時間 | 30 秒と 10 秒（例） | RFC 6455 は決めていない |
| オプション | `problem`（none / badAccept / noPong）× `fragment` | 6 通り。ws と wss、ポーリングとの比較は概要で扱う |
| 状態の値 | readyState は WHATWG の CONNECTING / OPEN / CLOSING / CLOSED。表の列名は Stage / Value | 画面の文言の Step と重なると、日本語のページで英語の文言が混ざったと判定される |
| 扱わないもの | permessage-deflate、サブプロトコル、TCP の ACK、プロキシ、HTTP/2・HTTP/3 の上の WebSocket（RFC 8441 / RFC 9220） | 主題がぼやける。permessage-deflate、プロキシ、HTTP/2・HTTP/3 の上の WebSocket は概要で触れる。TCP の ACK はシナリオの本文で断る |

### Phase 10: NAT 越え（STUN・TURN・ICE）

**完了条件**: 「ネットワークにつながるまで」（`ip`）の NAT の次に、NAT 越えのテーマがあり、根拠の RFC、クイズ、en／ja の概要がある。

**完了**（#210〜#212）: テーマは 28 → 29（NAT 越え）。STUN のバイト列と ICE の優先度の純関数（`stun.ts`、`ice.ts`）と、NAT の対応づけとフィルタリングの模型（`model.ts`）を足した。エンジンは、シーケンス図が横にはみ出すときにキーボードでスクロールできるようにした。

| # | タスク | ラベル |
|---|---|---|
| 10-1 | NAT 越えのシナリオ（STUN の Binding と XOR-MAPPED-ADDRESS、TURN の Allocate・401・CreatePermission・ChannelBind・Send / Data・ChannelData・Refresh、ICE の優先度・チェックリスト・接続性チェック・トリガーされたチェック・peer reflexive・指名。もしも: NAT B がアドレスとポートごとの対応づけ、UDP が止められる、許可の期限切れ）とテスト | content |
| 10-2 | NAT 越えのページ（概要、クイズ、登録） | content |
| 10-3 | PLAN、CLAUDE.md、README、用語集の仕上げ | content |

Issue は #210〜#212 に分けて起票した。

#### Phase 10 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `ip` の NAT の次 | NAT のテーマの続き。ビデオ通話の例で見せ、WebRTC の API には触れない |
| テーマの数 | 1 つ（STUN、TURN、ICE をまとめる） | 直接つながるか中継に回るかの分かれ目を、同じ図で見比べられる |
| レーン | PC A、NAT A、STUN・TURN サーバー（1 台）、NAT B、PC B の 5 本 | 図の幅に収まる。TURN のサーバーは STUN のサーバーでもある（coturn など）。シグナリングのサーバーは描かず、SDP は文章で見せる |
| NAT の模型 | 対応づけ（EIM / APDM）とフィルタリング（APDF）を計算し、NAT の表と、パケットが届くか捨てられるかを決める | 手で書いた値と規則がずれない |
| NAT A のフィルタリング | どの場合も APDF | NAT B が APDM のとき、NAT A が APDF でなければ（アドレスだけのフィルタリングなら）、ICE は peer reflexive の候補で直接の経路を見つけうる。中継に回る例を作るため（このページの判断） |
| TURN の認証 | SHA-256（MESSAGE-INTEGRITY-SHA256、PASSWORD-ALGORITHM）。401 の後に新しいトランザクション ID で送り直す | RFC 8489 は MD5 を古い実装との互換のためだけに残す。RFC 8656 §20 の例と同じ |
| ICE のチェックの完全性 | MESSAGE-INTEGRITY（HMAC-SHA1） | RFC 8445 は RFC 5389 を前提にしている |
| バイト列と優先度 | 純関数で作り、RFC 5769 のテストベクター（XOR のアドレス、FINGERPRINT、PRIORITY）と RFC 8839 の例でテストする。候補ペアの優先度は BigInt | 2^53 を超える |
| オプション | `network`（independent / symmetric / udpBlocked）× `permissionExpires` | 6 通り（`independent` のときは許可の切り替えが効かないので、実質 5 通り） |
| 更新の時刻 | 4 分後に ChannelBind（許可とチャネル）と Refresh（割り当て） | 許可は 300 秒、割り当てとチャネルは 600 秒。データを送っても更新されない |
| 用語 | SDP の answer は「アンサー」、STUN の response は「応答」 | 用語集で書き分ける |
| 扱わないもの | IPv6、ICE-TCP、TURN の TCP の割り当て（RFC 6062。PC A とサーバーの間の TLS は扱う）、Trickle ICE の流れ、mDNS のホスト候補、ICE の再起動、ice-lite、役割の衝突（487）、438、ALTERNATE-SERVER、DTLS-SRTP の詳細 | 主題がぼやける。IPv6、ICE-TCP、Trickle ICE は概要で触れる |

### Phase 11: Wi-Fi

**完了条件**: 「LAN の中」（`lan`）の VLAN の次に、Wi-Fi に参加するテーマがあり、根拠の規格、クイズ、en／ja の概要がある。

**完了**（#216〜#218）: テーマは 29 → 30（Wi-Fi）。Frame Control とアドレスの並び（`frame.ts`）、OFDM の通信時間と Duration・CW（`airtime.ts`）、EAPOL-Key の Key Information（`eapol.ts`）の純関数を足した。あわせて、ほかのテーマの説明用の MAC アドレスの根拠を RFC 9542 §2.1.4 に、EtherType の根拠を IANA のレジストリに直した（#219）。

| # | タスク | ラベル |
|---|---|---|
| 11-1 | Wi-Fi のシナリオ（Beacon、Probe、Open System 認証、アソシエーションと AID、EAPOL-Key 1〜4、ToDS / FromDS と 3 つのアドレス、DIFS とバックオフ、SIFS 後の Ack。もしも: パスフレーズの誤り、Ack の消失、隠れ端末、隠れ端末と RTS/CTS、アドホック）とテスト | content |
| 11-2 | Wi-Fi のページ（概要、クイズ、登録） | content |
| 11-3 | PLAN、CLAUDE.md、README、用語集の仕上げ | content |

Issue は #216〜#218 に分けて起票した。

#### Phase 11 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `lan` の VLAN の次 | 有線のスイッチ・VLAN のあとに、無線の LAN。参加したあとの DHCP・ARP はリンクするだけで繰り返さない |
| テーマの数 | 1 つ（インフラストラクチャモードが主、アドホックはもしもの 1 つ） | 同じ図で AP を通る 2 区間と、IBSS の 1 区間を見比べられる |
| 根拠の版 | IEEE Std 802.11-2024（節の番号は 2016 / 2020 と同じ並び） | 2020 は置き換えられた。IEEE の規格は節の題名で引き、IEEE GET Program を案内する |
| レーン | ノート PC（STA A）、AP、スマートフォン（STA B）の 3 本。AP の種類は `switch` | AP は無線と有線の間の L2 のブリッジ。ActorKind は色にしか使わないのでエンジンは変えない。有線の側は描かない |
| 電波の届く範囲 | 各アクターの状態 `hears` と、矢印を描かないことで示す | 線のない網では、図だけでは誰に届くかわからない |
| オプション | `situation`（normal / wrongPassphrase / lostAck / hiddenNode / rtsCts / adhoc）の 1 つの選択 | 2 つの軸にすると意味のない組み合わせ（オープンな IBSS でパスフレーズの誤りなど）ができる |
| PHY とメディアアクセス | 5 GHz の non-HT OFDM（24 Mb/s）、DCF と DIFS | 今の機器は EDCA（ベストエフォートの AIFS 43 µs）だが、しくみは同じ。概要で比べる |
| 時間 | タイマーは使わず、µs の値はフィールドと状態で示す | `formatSeconds` は秒の小数 1 桁までなので、µs は 0 s になる |
| バックオフの数 | 隠れ端末では 5 と 2 スロット（衝突する）、RTS/CTS では 9 と 2 スロット（CTS が届いたとき 3 スロット残る） | RTS（28 µs）と CTS の時刻を計算して、図の話と合わせた |
| PMK | PBKDF2 の値をテストで WebCrypto と照らし合わせ、Annex J.4 のテストベクタも再現する。PTK の値は示さない | 手で書いた値の誤りを防ぐ。ノンスを示さないので PTK は計算できない |
| 管理フレームの Ack | データの区間でだけ描く | 図が込み入る。最初のユニキャストの管理フレームで断る |
| 扱わないもの | QoS（EDCA の細部）、パワーセーブと DTIM、フラグメンテーション、A-MPDU と Block Ack、802.11r/k/v、802.1X/EAP（Enterprise）、WPS、2.4 GHz の時間、IBSS の RSNA、MLO | 主題がぼやける。EDCA、WPA3・SAE・PMF、KRACK、Wi-Fi Direct、802.11s は概要で触れる |

### Phase 12: リバースプロキシとロードバランサー

**完了条件**: 「Web 開発で出会う HTTP」（`http`）の WebSocket の次に、リバースプロキシとロードバランサーのテーマがあり、根拠の RFC と PROXY protocol の仕様、クイズ、en／ja の概要がある。

**完了**（#224〜#226）: テーマは 30 → 31（リバースプロキシとロードバランサー）。転送のヘッダー（Forwarded、X-Forwarded-For、Via、区間ごとのフィールド、Proxy-Status、Cache-Status）の値を作る `headers.ts`、振り分けとヘルスチェックの `balancer.ts`、共有キャッシュの判断の `sharedCache.ts`、PROXY protocol の版 1 の `proxyProtocol.ts` の純関数を足した。レビューで、RFC 8446 が RFC 9846 に置き換えられたことがわかった（ほかのテーマの更新は #228）。

| # | タスク | ラベル |
|---|---|---|
| 12-1 | リバースプロキシとロードバランサーのシナリオ（ヘルスチェック、TLS の終端、Host・Forwarded・X-Forwarded-*・Via、区間ごとのフィールド、ラウンドロビン、接続の使い回し。もしも: バックエンドが落ちる、遅い、スティッキーセッション、L4 と PROXY protocol、共有キャッシュ）とテスト | content |
| 12-2 | リバースプロキシとロードバランサーのページ（概要、クイズ、登録） | content |
| 12-3 | PLAN、CLAUDE.md、README、用語集の仕上げ | content |

Issue は #224〜#226 に分けて起票した。

#### Phase 12 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `http` の WebSocket の次 | HTTP/2・TLS・キャッシュの知識をまとめて使う。HTTP のキャッシュのテーマが扱わなかった共有キャッシュを補う |
| レーン | ブラウザー、プロキシ／LB（`router`）、バックエンド A・B（`server`）の 4 本 | ActorKind は色にしか使わないのでエンジンを変えない（Phase 11 の AP と同じ）。バックエンドと見分けられる |
| プロトコル | ブラウザーとの間は TLS の中の HTTP/2（`encrypted`）、バックエンドとの間は平文の HTTP/1.1 | :authority から Host、Via の 2.0 と 1.1、区間ごとのフィールドの除去を 1 つの流れで見せる。鍵の印がプロキシで止まることで TLS の終端を示す |
| 転送のヘッダー | Forwarded（RFC 7239）と X-Forwarded-For / -Proto の両方。値は純関数で作り、RFC の例でテストする | 標準と事実上の標準を並べる。手で書いた値と規則がずれない |
| 標準でないもの | 振り分け、ヘルスチェック、スティッキー Cookie、待ち時間、PROXY protocol は「例えば nginx や HAProxy では」と書き、数値は例の値とする | RFC 9110 は負荷分散があることに触れるだけ。製品の既定の数値は書かない |
| エラーの状態コード | RFC 9209 の Proxy-Status の error と推奨する状態コードから 502 / 504 を決める（`ERROR_STATUS`） | 標準の対応があり、根拠を示せる。503 は説明と概要の表で扱う |
| オプション | `situation`（normal / backendDown / slowBackend / sticky / l4 / sharedCache）の 1 つの選択 | L4 とキャッシュ・Cookie の組み合わせは成り立たない（Phase 11 と同じ） |
| POST の再試行 | 途中で切れた POST は再試行せず 502 を返す | RFC 9110 §9.2.2 でプロキシは MUST NOT。GET なら再試行できると書く |
| TCP | L4 の場合だけ 3 ウェイハンドシェイクを描く | L4 では接続が振り分けの単位になる |
| Content-Length | HTTP/1.1 の本文のある要求と応答に付ける。本文は「…」で縮め、示した本文のバイト数とする | 持続する接続では、メッセージの終わりを知るのに要る（RFC 9112 §6.3） |
| 扱わないもの | 重み付け・最小接続数・ハッシュ、Vary の詳細、stale-while-revalidate、要求の集約、バックエンドへの TLS、PROXY protocol の版 2、DSR の図、HTTP/3、WebSocket の中継 | 主題がぼやける。一部は概要で触れる |

### Phase 13: Cookie と CSRF

**完了条件**: 「ネットワークのセキュリティ」（`security`）に Cookie と CSRF のテーマがあり、根拠（rfc6265bis の草案 -22、RFC 6265、HTML・URL・Fetch Standard、Fetch Metadata、RFC 6454 / 9110）、クイズ、en／ja の概要がある。

**完了**（#244〜#246）: テーマは 31 → 32（Cookie と CSRF）。オリジンと同じサイトの判定（`site.ts`。PSL はごく一部）、SameSite の解析と Cookie を付けるかどうか（`cookies.ts`。草案 §5.8.3、Lax-allowing-unsafe）、Origin と Sec-Fetch-Site（`requestHeaders.ts`）の純関数を足した。

| # | タスク | ラベル |
|---|---|---|
| 13-1 | Cookie と CSRF のシナリオ（ログインと Set-Cookie、evil.example の隠しフォームの自動送信、Origin・Sec-Fetch-Site・Initiator。もしも: Lax、Strict、Lax でも GET で送金、CSRF トークン、Fetch Metadata と Origin の確認）とテスト | content |
| 13-2 | Cookie と CSRF のページ（概要、クイズ、登録） | content |
| 13-3 | PLAN、CLAUDE.md、README の仕上げ | content |

Issue は #244〜#246 に分けて起票した。

#### Phase 13 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `security` の最後（メールの送信ドメイン認証の次。Phase 14 で HSTS がその間に入った） | Cookie の守りは、トランスポートの守りの次。前提の CORS は `http` にあり、先に読む |
| オプション | `situation`（none / lax / strict / laxGet / token / fetchMetadata）の 1 つの選択 | 防御を組み合わせると意味の薄い組が増える（Phase 11・12 と同じ） |
| 根拠の版 | draft-ietf-httpbis-rfc6265bis-22 を草案だと明記して節番号で引く（2026-09-29 に datatracker で RFC Ed Queue を確認）。RFC 6265 を添える | RFC 6265 には SameSite がない。RFC になったら引用を直す |
| 規格の置き場所 | same site は HTML、registrable domain は URL、Origin は Fetch、Sec-Fetch-* は W3C の Fetch Metadata（Working Draft） | Living Standard は節番号が動くので、名前とアンカーで引く |
| レーン | ブラウザー、bank.example、evil.example の 3 本。利用者のレーンは作らない | 利用者の操作はネットワークのメッセージではない。誰が始めた要求かは Initiator のフィールドと section の帯で示す |
| 既定の Cookie | `SameSite=None; Secure` を明示する | 属性のない Cookie は、草案では Lax と同じだが、ブラウザーの動きが揃っていない（Firefox は None）。どのブラウザーでも攻撃が再現できる |
| フォームの送り方 | トップレベルのナビゲーション | Lax の例外と一致する。サードパーティー Cookie の制限と混ざらない。CORS の対比（fetch）は、サードパーティー Cookie を許すブラウザーだと断る |
| 扱わないもの | 同じサイトの攻撃者の図（アクターを増やす）、ログイン CSRF、`__Host-`、XSS、CHIPS、ダブルサブミット Cookie | 主題がぼやける。一部は概要で触れる |

### Phase 14: HSTS と SSL ストリッピング

**完了条件**: `security` に HSTS と SSL ストリッピングのテーマがあり、根拠の RFC（6797 / 9110 / 6265 / 9846 / 9460、rfc6265bis の草案）、クイズ、en／ja の概要がある。

**完了**（#249〜#251）: テーマは 32 → 33（HSTS と SSL ストリッピング）。Strict-Transport-Security の解析（`sts.ts`。§6.1 の癖と §6.2 の例）、既知の HSTS ホストの記録と照合と書き換え（`store.ts`。§8.1〜§8.3）、Cookie の送信（`cookies.ts`。RFC 6265 §5.4）の純関数を足した。SYN フラッドのテーマも設計したが、見送った（#253〜#255）。

| # | タスク | ラベル |
|---|---|---|
| 14-1 | HSTS のシナリオ（HSTS なしのストリッピング。もしも: 既知の HSTS ホスト、期限切れ、攻撃者の証明書、includeSubDomains、プリロードリスト）とテスト | content |
| 14-2 | HSTS のページ（概要、クイズ、登録） | content |
| 14-3 | PLAN、CLAUDE.md、README の仕上げ | content |

Issue は #249〜#251 に分けて起票した。

#### Phase 14 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `security` のメールの送信ドメイン認証の次、Cookie と CSRF の前 | TLS の知識を使う。トランスポートの守りから Cookie の守りへ |
| レーン | ブラウザー、攻撃者（経路上。`router`）、サイト（example.com と www）の 3 本。DNS は描かない | 攻撃に要るのは経路だけ。すべてのメッセージを攻撃者を経由して区間ごとに描き、http は読めて TLS は読めないことを見せる |
| HSTS ホスト | 頂点の example.com。www は includeSubDomains の例 | 記録はホストごと（§5.3）。プリロードは頂点のドメインに要る |
| オプション | `situation`（noHsts / known / expired / badCert / subdomain / preload）の 1 つの選択 | 2 つの軸にすると、意味のない組み合わせができる |
| 初めての訪問 | 期限切れの選択肢と同じ流れとして説明し、プリロードの選択肢で答えを示す | 通信の上では同じ |
| Cookie の上書き | 攻撃者が Secure を外した Set-Cookie は、既存の Secure の Cookie を上書きできない（rfc6265bis §5.7 手順 16）として、Cookie の表は変えない | 今のブラウザーの動き。攻撃者はセッションを自分の TLS の接続で読んでいるので、攻撃は成り立つ |
| RFC でないもの | sslstrip（Black Hat DC 2009）、プリロードリスト（hstspreload.org、2026-09-29 に確認）、Chrome の自動の https への書き換え（Google のブログ、2025 年 10 月の発表）は、日付を添える | 変わりやすい |
| 扱わないもの | 攻撃者が経路に入る手段、TCP と NAT、301 のキャッシュ、IDNA、`<meta>` | 主題がぼやける。一部は概要で触れる |

### Phase 15: Server-Sent Events

**完了条件**: 「Web 開発で出会う HTTP」（`http`）に Server-Sent Events のテーマがあり、根拠（HTML Standard の Server-sent events、Fetch Standard、RFC 9110 / 9112 / 9113）、クイズ、en／ja の概要がある。

**完了**（#239、#258、#259）: テーマは 33 → 34（Server-Sent Events）。エンジンの変更はない。text/event-stream の解析（`eventStream.ts`。HTML Standard の手順と例）、応答の検査と再接続（`reconnect.ts`）、チャンクのサイズ（`chunked.ts`）の純関数を足した。

| # | タスク | ラベル |
|---|---|---|
| 15-1 | SSE のシナリオ（イベントの受信。もしも: 切れた接続と Last-Event-ID、204、誤った Content-Type、HTTP/1.1 の 6 つのタブ、HTTP/2）とテスト | content |
| 15-2 | SSE のページ（概要、クイズ、登録） | content |
| 15-3 | PLAN、CLAUDE.md、README の仕上げ | content |

Issue は、利用者が起票した #239 をシナリオに使い、#258 と #259 を足した。

#### Phase 15 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `http` の WebSocket の次、リバースプロキシの前 | WebSocket と比べて読む。プロキシのバッファリングは概要で触れる |
| アクター | ブラウザーとサーバーの 2 つ。プロキシは描かない | 線の上のやりとりは変わらない |
| オプション | `situation`（normal / reconnect / stop204 / wrongType / http1Limit / http2）の 1 つの選択 | 2 つの軸にすると、意味のない組み合わせができる（Phase 11〜14 と同じ） |
| 解析 | HTML Standard の手順を純関数にし、仕様の例をテストで再現する。チャンクとイベントの区切りをそろえて描く | 手で書いた data の値の誤りを防ぐ。区切りがずれる場合は関数とテストが扱う |
| 状態の値 | readyState は HTML の CONNECTING / OPEN / CLOSED | 画面の文言と重ならない |
| 標準でないもの | HTTP/1.1 の約 6 本の上限（ブラウザーの動き。RFC 9112 §9.4 は数を決めない）、Last-Event-ID の後の送り直し（アプリケーションの仕事）、nginx のバッファリング | そう断って書く |
| 扱わないもの | TCP と TLS、ヘッダーの多く、バックオフ、HTTP/2 の序文と HPACK、`fetch()` で読むストリーム | 主題がぼやける。`fetch()` とプロキシは概要で触れる |

### Phase 16: 学習の道筋

**完了条件**: 対象者別の学習の道筋があり、道筋ごとのページ、ホームの入口、テーマのページの前後のテーマへのリンクがある。

**完了**（#264〜#267）: 道筋は Web エンジニア向け（14 テーマ）とインフラ運用向け（16 テーマ。Phase 17 でコンテナーのネットワークを足して 17、Phase 18 で VXLAN を足して 18、Phase 19 で WireGuard を足して 19）。テーマの数は変わらない。

| # | タスク | ラベル |
|---|---|---|
| 16-1 | 道筋のデータ（`learningPaths.ts`）、`?path=` と道筋の中の位置の純関数（`learningPathNav.ts`）、クイズの進捗の集計（`progress.ts`） | enhancement |
| 16-2 | 道筋のページ（`/:locale/paths/:id`）、ホームの入口のカード、静的ページ | enhancement |
| 16-3 | テーマのページの道筋の中の位置と前後のテーマへのリンク | enhancement |
| 16-4 | PLAN、CLAUDE.md、README の仕上げ | documentation |

Issue は #264〜#267 に分けて起票した（元は #243）。

#### Phase 16 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 対象者の表し方 | テーマごとの対象者のタグではなく、順番付きの道筋にする（利用者が決めた） | 多くのテーマが両方の対象者に当てはまり、タグでは選ぶ手がかりにならない |
| 見せ方 | 道筋ごとのページ。ホームには入口のカード（利用者が決めた） | 順番と「次に何を読むか」を示せる。静的ページ・sitemap にも載る |
| 道筋 | Web エンジニア向けとインフラ運用向けの 2 つ。セキュリティは #234・#235 のあとに考える | セキュリティは対象者ではなく話題で、分類の一覧と大きく重なる |
| どの道筋から来たか | `?path=`（zod で検証）。ないか、知らない値か、テーマを含まない道筋なら、テーマを含む道筋から決める（1 つならその道筋、複数なら並べる）。URL は書き換えない | ステップの URL の同期は他のクエリを残すので、`?path=` は消えない。canonical はクエリを持たない |
| 位置の文言 | 「Theme n of m」「m テーマ中 n 番目」 | ステップ実行の「Step n of m」と紛れる。e2e もその文言でステップ数を読む |
| 進捗 | ホームの全体の進捗（#240）と同じ「クイズを全問答えたテーマ」で数える | 定義をそろえる |
| 道筋の色 | 使わず、名前で見分ける（アイコンはどの道筋も同じ） | 分類の 7 つの色相とぶつかる |
| テーマを足すとき | どの道筋に入れるかをテーマの PR で決め、前提の順はテストで確かめる | 型では「入れ忘れ」を防げない |

### Phase 17: コンテナーのネットワーク

**完了条件**: `lan` にコンテナーのネットワークのテーマがあり、根拠（RFC、IEEE 802.1Q、Linux の文書、Docker のドキュメント）、クイズ、en／ja の概要がある。

**完了**（#269〜#271）: テーマは 34 → 35（コンテナーのネットワーク）。エンジンの変更は、状態の表の枠に `relative` を付けただけ（新しい行の読み上げ用の文字が枠を越えて、390px でページを広げていた）。ブリッジの学習と転送（`bridge.ts`）、接続の追跡と NAT（`conntrack.ts`）の純関数を足した。インフラ運用の道筋の VLAN の次に入れた。

| # | タスク | ラベル |
|---|---|---|
| 17-1 | シナリオ（MASQUERADE。もしも: ポートの公開、同じブリッジ、ユーザー定義のネットワーク、同じ送信元ポート、公開していないポート）とテスト | content |
| 17-2 | ページ（概要、クイズ、登録） | content |
| 17-3 | PLAN、CLAUDE.md、README の仕上げ | documentation |

Issue は #269〜#271 に分けて起票した（元は #238）。

#### Phase 17 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `lan` の VLAN の次 | ブリッジは 1 台のホストの中の LAN。前提の ARP・NAT（`ip`）とスイッチ（`lan`）が先にある |
| レーン | コンテナー A・B、ブリッジ、ホスト、外部のホストの 5 本。veth ペアはレーンにせず、矢印の Link のフィールドで示す | veth は判断をしないケーブル（veth(4)）。レーンにすると矢印が倍になる |
| ホスト | 経路の選択と netfilter を 1 本のレーンにする | 同じカーネルが同じパケットを扱い、別の線の上のパケットではない |
| アドレス | Docker の既定（172.17.0.0/16、172.17.0.1）。ホストと外は RFC 5737、MAC は RFC 9542 | 学ぶ人が実際に見る値。MAC の作り方は Engine 28 で変わったので、説明用の値にする |
| オプション | `situation`（outbound / published / sameBridge / userNetwork / twoContainers / unpublished）の 1 つの選択 | Phase 11〜15 と同じ |
| 一貫性 | ブリッジの表と接続の追跡は純関数から作り、矢印と表を食い違わせない | 手で書いた表の誤りを防ぐ |
| 標準か実装か | 根拠を「標準」「Linux」「Docker」に分けて書き、版で変わるもの（iptables と nftables、docker-proxy、MAC の生成、br_netfilter）は描かずに概要で書き分ける | Issue の指示。実装の話を標準のように書かない |
| 扱わないもの | ヘアピン（docker-proxy が関わる）、IPv6、ルーテッドモード、Kubernetes、VXLAN（#236） | 版と設定で道が変わる。オーバーレイは別のテーマ |

### Phase 18: VXLAN

**完了条件**: `lan` に VXLAN のテーマがあり、根拠（RFC 7348 ほか、Linux の文書）、クイズ、en／ja の概要がある。

**完了**（#279〜#281）: テーマは 35 → 36（VXLAN）。エンジンの変更はない。ヘッダー（`header.ts`）、オーバーヘッド（`overhead.ts`）、VNI ごとの転送の表とスプリットホライズン（`vtep.ts`）、外側の送信元ポートと ECMP（`entropy.ts`）の純関数を足した。インフラ運用の道筋のパス MTU 探索の次に入れた（17 → 18 テーマ）。コンテナーのネットワークのシナリオの表が、前のステップで後の行を見せうる書き方（同じ配列を持ち回る）だったので、あわせて直した。

| # | タスク | ラベル |
|---|---|---|
| 18-1 | シナリオ（最初の通信: 送信元での複製と学習。もしも: マルチキャスト、コントロールプレーン、2 つのテナント、MTU、ECMP）とテスト | content |
| 18-2 | ページ（概要、クイズ、登録） | content |
| 18-3 | PLAN、CLAUDE.md、README の仕上げ | documentation |

Issue は #279〜#281 に分けて起票した（元は #236。WireGuard はまだ）。

#### Phase 18 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 範囲 | VPN／オーバーレイを 2 つのテーマに分け（利用者が決めた）、VXLAN（コンテナーのネットワークの次）を先に作る。WireGuard は別のテーマ。IPsec は WireGuard の概要で比べるだけ | コンテナーのネットワークの続きとして読める |
| 分類と位置 | `lan` のコンテナーのネットワークの次 | 延ばすのは L2 のセグメント。前提のスイッチ・VLAN・コンテナーのネットワークが先にある |
| レーン | コンテナー A、VTEP 1、アンダーレイ、VTEP 2、コンテナー B の 5 本 | カプセル化するのは VTEP だけで、コンテナーは見ない（RFC 7348 §4）。アンダーレイは TTL と複製と経路の選択が起きる場所 |
| VTEP | ホストのブリッジと VXLAN のデバイスを 1 本のレーンにする | Phase 17 のホストと同じ理由 |
| オプション | `situation`（firstContact / multicast / controlPlane / tenants / mtu / ecmp）の 1 つの選択 | Phase 11〜15・17 と同じ |
| DF ビット | フィールドに描かず、「RFC 7348 に要件はない」と概要で書く | RFC 7348 §4.3 は VTEP が断片化しないことだけを決める。Linux の既定（unset）は実装 |
| 文書の位置づけ | RFC 7348 は Informational（Independent）と書き、「標準」とは呼ばない | rfc-index で確かめた |
| ポート | 4789（IANA）。Linux の既定の 8472 は実装として概要で書く | 学ぶ人が実機で出会う |
| アドレス | オーバーレイは RFC 1918、アンダーレイは RFC 5737、マルチキャストは MCAST-TEST-NET（RFC 5771）、MAC は RFC 9542 | 説明用の値 |
| 送信元ポートと経路 | 説明用のハッシュ（FNV-1a）で決め、値をテストで固定する | ハッシュの関数は決まっていない |
| 扱わないもの | EVPN の経路の交換（BGP）、VXLAN-GPE、VLAN とのゲートウェイ、セグメント間の経路制御、暗号化（WireGuard のテーマへ） | 主題がぼやける。EVPN（BGP）と、暗号化がないことは概要で触れる |

### Phase 19: WireGuard

**完了条件**: `security` に WireGuard のテーマがあり、根拠（ホワイトペーパー、Noise、RFC 7748/8439/7693、wg(8)、Linux の実装）、クイズ、en／ja の概要がある。

**完了**（#285〜#287）: テーマは 36 → 37（WireGuard）。エンジンの変更はない。メッセージの形式と大きさ（`messages.ts`）、暗号鍵ルーティング（`cryptokey.ts`。経路の検索のテーマの最長一致を使う）、リプレイの窓（`replay.ts`）、タイマー（`timers.ts`）、鍵の組の入れ替え（`keypairs.ts`）、時間で切れる NAT の対応（`nat.ts`）の純関数を足した。インフラ運用の道筋のファイアウォールの次に入れた（18 → 19 テーマ）。これで #236（VPN／オーバーレイ）の 2 つのテーマがそろった。

| # | タスク | ラベル |
|---|---|---|
| 19-1 | シナリオ（最初のハンドシェイク。もしも: 拒むパケット、ローミング、NAT の寿命と PersistentKeepalive、鍵の更新、cookie）とテスト | content |
| 19-2 | ページ（概要、クイズ、登録） | content |
| 19-3 | PLAN、CLAUDE.md、README の仕上げ | documentation |

Issue は #285〜#287 に分けて起票した（元は #236）。

#### Phase 19 の判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 分類と位置 | `security` のファイアウォールの次 | ネットワーク層の守り。ファイアウォールの UDP の対応の寿命が、キープアライブにつながる |
| レーン | ノート PC、Wi-Fi のルーター（NAT）、インターネットの攻撃者、VPN サーバー、内部のサーバーの 5 本 | NAT はエンドポイントとキープアライブの話に要る。攻撃者は拒む状況と負荷の状況で使う。インターネットの経路はレーンにしない |
| オプション | `situation`（handshake / rejected / roaming / keepalive / rekey / underLoad）の 1 つの選択 | Phase 11〜15・17・18 と同じ |
| MTU | 状況にせず、各パケットの大きさと概要で示す | Linux は外側に DF を立てず、途中で断片化される。ブラックホールは VXLAN で見せた |
| 暗号 | 計算せず、鍵は名前（pub:laptop、E_pub(…)）、暗号化したフィールドは式（AEAD(k, …)）で示す | 本物の値は学ぶ役に立たず、誤りのもとになる |
| 根拠 | RFC ではなくホワイトペーパー（改訂版）を主にし、wg(8)・wg-quick(8)・Linux の実装で決まること（窓 8128、MTU 1420、DF、負荷の判定）を書き分ける | 仕様がどこにあるかをはっきりさせる |
| NAT の寿命 | キープアライブの状況は 30 秒（RFC 4787 REQ-5 の 2 分より短い機器の例と明記）、ほかは 2 分 | 2 分にすると、キープアライブの流れの途中で鍵の更新が起きて主題がぼやける |
| 鍵を消す時刻 | 540 秒は、最後にセッションができてから数える。previous の鍵の組は次の入れ替えで捨てる | レビューで直した。鍵の組ができてからではない |
| 扱わないもの | 事前共有鍵、フルトンネルの経路の設定、IPv6、レート制限、送り直しのゆらぎ | 主題がぼやける。一部は概要で触れる |

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| 技術的な内容の誤り（学習サイトでは致命的） | シナリオに RFC などの参照コメントを必須にする（テーマごとの根拠の一覧は CLAUDE.md の「学習コンテンツの正確性」）。seq/ack やメッセージ順はテストで固定し、テーマごとにレビューの Issue を立てる |
| エンジンの過剰な汎用化 | 対象をシーケンス型に限る。3 テーマ目で型を見直す前提にする |
| DNS はアクターが多く、画面の横幅が足りない | SVG の viewBox と横スクロールで対応し、モバイルでは短いラベルにする |
| TLS 1.3 の暗号化区間の見せ方 | 暗号化されていることを図で示し、中身は教育目的で見せる旨をインスペクタに注記する |
| 英日で説明の粒度がずれる | 用語集を作り、テーマごとに翻訳レビューを行う |
| GitHub Pages に PR プレビューがない | MVP は `vite preview` で確認する。必要になったら PR プレビュー用の Action を追加する |
