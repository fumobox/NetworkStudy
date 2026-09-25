# NetworkStudy 計画書

ネットワークプロトコルの動きを、1パケットずつ自分の手で進めながらインタラクティブに学ぶポータルサイト。

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

サイト上の推奨学習順は DNS → TCP → TLS。実装は TCP から始める。

### 将来の追加候補

| 優先度 | テーマ | インタラクション |
|---|---|---|
| 高 | HTTPS の全体像（DNS→TCP→TLS→HTTP を 1 本につなげる） | 既存シナリオの合成 |
| 高 | OSI 参照モデル／カプセル化 | レイヤを積み上げるアニメーション |
| 高 | IP／サブネット計算 | 計算ツール |
| 中 | ARP、TCP の 4 ウェイクローズ、再送・輻輳制御（cwnd グラフ） | シーケンス図（＋グラフ） |
| 中 | NAT／ルーティング | トポロジ図（React Flow を検討） |
| 低 | DHCP、ICMP（ping/traceroute）、QUIC | シーケンス図 |

## 3. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 基盤 | React 19 + Vite + TypeScript（strict） | `any` 禁止、`as` は原則禁止（`as const` と `satisfies` は可） |
| UI | Tailwind CSS v4 + shadcn/ui | Button, Card, Tabs, Tooltip, Slider, Toggle, Collapsible, Sheet |
| ルーティング | React Router v8（宣言的モード、BrowserRouter） | `basename={import.meta.env.BASE_URL}` |
| 可視化 | SVG + Motion（旧 framer-motion） | シーケンス図は決まったレイアウトなので D3 などのレイアウトエンジンは不要 |
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

ラベルは `design` / `enhancement` / `bug` / `infra` / `content` / `engine` / `i18n` / `theme:tcp` / `theme:dns` / `theme:tls` / `phase:0`〜`phase:3`。

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

| # | タスク | ラベル |
|---|---|---|
| 3-1 | Playwright のスモークテスト（各テーマ × 各ロケールで最終ステップまで進める） | infra |
| 3-2 | 用語集 `docs/glossary.md`（訳語の統一、翻訳しない用語の一覧） | i18n, content |
| 3-3 | HTTPS の全体像（シナリオを合成するヘルパー） | content |
| 3-4 | OSI の積み上げアニメーション | content |
| 3-5 | サブネット計算ツール | content |
| 3-6 | トポロジ系で React Flow を導入するか判断する | design |
| 3-7 | TCP の 4 ウェイクローズ、再送・輻輳制御 | theme:tcp |

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| 技術的な内容の誤り（学習サイトでは致命的） | シナリオに RFC の参照コメントを必須にする（TCP: RFC 9293、DNS: RFC 1034/1035、TLS 1.3: RFC 8446、証明書: RFC 5280）。seq/ack やメッセージ順はテストで固定し、テーマごとにレビューの Issue を立てる |
| エンジンの過剰な汎用化 | 対象をシーケンス型に限る。3 テーマ目で型を見直す前提にする |
| DNS はアクターが多く、画面の横幅が足りない | SVG の viewBox と横スクロールで対応し、モバイルでは短いラベルにする |
| TLS 1.3 の暗号化区間の見せ方 | 暗号化されていることを図で示し、中身は教育目的で見せる旨をインスペクタに注記する |
| 英日で説明の粒度がずれる | 用語集を作り、テーマごとに翻訳レビューを行う |
| GitHub Pages に PR プレビューがない | MVP は `vite preview` で確認する。必要になったら PR プレビュー用の Action を追加する |
