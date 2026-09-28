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

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| 技術的な内容の誤り（学習サイトでは致命的） | シナリオに RFC の参照コメントを必須にする（TCP: RFC 9293、DNS: RFC 1034/1035、TLS 1.3: RFC 8446、証明書: RFC 5280、ARP: RFC 826、DHCP: RFC 2131/2132、ICMP: RFC 792/1122/1812、NAT: RFC 3022/4787/5382、経路制御: RFC 1812/4632、HTTP のキャッシュ: RFC 9111/9110、CORS: Fetch Standard（WHATWG）・RFC 6454、HTTP/1.1・HTTP/2: RFC 9112/9113/7541、QUIC・HTTP/3: RFC 9000/9001/9002/9114、スイッチ・VLAN: IEEE Std 802.1Q-2022・RFC 4188、IPv6: RFC 4291/5952/4861/4862/2464、TCP のフロー制御: RFC 9293/1122/7323、SACK: RFC 2018/5681/6675/6582/8985、パス MTU 探索: RFC 1191/791/792/1812/6691/2516/2923/4821/8899/8201、ファイアウォール: RFC 6092/4787/5382/7857/9293/792/1122/1812、DNSSEC: RFC 4033/4034/4035/6840/5155/3225/6891/9904、メールの送信ドメイン認証: RFC 5321/5322/7208/6376/9989/9990/8601/7960/8617/3463、WebSocket: RFC 6455・WebSockets Standard（WHATWG）・RFC 9110、NAT 越え: RFC 8489/8656/8445/4787/8839/5769/7675/8838）。seq/ack やメッセージ順はテストで固定し、テーマごとにレビューの Issue を立てる |
| エンジンの過剰な汎用化 | 対象をシーケンス型に限る。3 テーマ目で型を見直す前提にする |
| DNS はアクターが多く、画面の横幅が足りない | SVG の viewBox と横スクロールで対応し、モバイルでは短いラベルにする |
| TLS 1.3 の暗号化区間の見せ方 | 暗号化されていることを図で示し、中身は教育目的で見せる旨をインスペクタに注記する |
| 英日で説明の粒度がずれる | 用語集を作り、テーマごとに翻訳レビューを行う |
| GitHub Pages に PR プレビューがない | MVP は `vite preview` で確認する。必要になったら PR プレビュー用の Action を追加する |
