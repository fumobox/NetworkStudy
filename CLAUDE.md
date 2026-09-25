# NetworkStudy

ネットワークプロトコル（TCP、DNS、TLS 1.3 など）の動きを、1 パケットずつ進めて学ぶインタラクティブな学習サイト。英語と日本語に対応した静的 SPA で、GitHub Pages（https://fumobox.github.io/NetworkStudy/）で配信する。

計画・ロードマップは [docs/PLAN.md](docs/PLAN.md)、シーケンスエンジンの設計は [docs/design/engine.md](docs/design/engine.md) を参照。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（`http://localhost:5173/NetworkStudy/`） |
| `npm run build` | 型チェック → vite build → 静的ページ生成（`dist/`） |
| `npm run preview` | ビルド結果の確認 |
| `npm run typecheck` | `tsc -b`（app / node / scripts の各 tsconfig） |
| `npm run lint` / `lint:fix` | ESLint（警告も失敗扱い）/ 自動修正 |
| `npm run depcruise` | 循環依存とレイヤ違反のチェック |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:run` / `test:coverage` | Vitest |
| `npm run pages:verify` | 生成した静的ページの検証（`build` の後に実行） |

CI（`.github/workflows/ci.yml` の `Check` job）は typecheck → lint → depcruise → format:check → test:run → build → pages:verify の順に実行する。main への push では、その後 `Deploy` job が GitHub Pages へデプロイする。

## 技術スタック

React 19 / Vite 8 / TypeScript 6（strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）/ Tailwind CSS v4 / shadcn/ui（Radix、Nova）/ React Router 8（宣言的モード）/ zod 4 / Vitest 5。Node 24。

## ディレクトリとレイヤ

```
src/
├── app/            ルーティング（AppRoutes, LocaleLayout, LocaleRedirect）
├── pages/          ページ
├── components/
│   ├── ui/         shadcn/ui の生成コード
│   ├── layout/     AppLayout, Header, Footer, LanguageSwitcher
│   └── features/   クイズ・進捗など（予定）
├── content/        テーマごとのシナリオ・クイズ・MDX（themeIds.ts にテーマ ID の一覧）
├── engine/         シーケンスエンジン（予定）
├── lib/            汎用処理（i18n/, storage.ts, utils.ts）
├── types/          横断的な型（DeepReadonly など）
└── test/setup.ts
scripts/            ビルド後の静的ページ生成・検証（tsx で実行）
```

依存の向きは **`app` / `pages` → `content` → `engine` → `lib`** の一方向。dependency-cruiser（`.dependency-cruiser.cjs`）で強制している。

- `lib` は `lib` と `types` にだけ依存する
- `engine` は `lib`・`types`・`components/ui` にだけ依存する（`content` や `pages` には依存しない）
- `content` は `pages`・`app`・`components/layout` に依存しない
- `components/ui` は `lib` にだけ依存する
- package.json に記載のないパッケージ（推移的依存）を直接 import しない
- `src/` のアプリコード（テストと `src/test/` を除く）から devDependencies を import しない（`import type` は可）。実行時に使うライブラリは `npm install`（`-D` なし）で入れる

## コーディング規約

- `any` 禁止（`unknown` と型ガードで絞り込む）。型アサーション `as` は禁止（`as const` と `satisfies` は可）。`!` 禁止。ESLint でエラーになる
- オブジェクト型は `interface`、ユニオンなどは `type`。`enum` ではなく `as const` とユニオン型
- 外部入力（localStorage、URL のクエリ）は zod などで検証してから型を付ける。localStorage は `lib/storage.ts` の `readStorage` / `writeStorage` を使う（例外は内部で握りつぶす）
- `cn` は、自前のコードでは `@/lib/utils` から import する（shadcn の生成コードは `cn` パッケージを直接 import したままでよい）
- `shadcn add` で追加したコンポーネントは、`exactOptionalPropertyTypes` で型エラーになることがある。そのときは最小限の手修正をし、理由をコメントに残す（例: `slider.tsx`）。生成コードのバグを直した場合も同様にコメントを残す（例: `tabs.tsx` の `orientation`）
- eslint-plugin-react-hooks v7 の recommended（React Compiler 系のルールを含む）は意図して有効にしている

## 多言語対応（i18n）

- URL は常に `/:locale/...`（`en` / `ja`）。ロケールのないパスは `LocaleRedirect` がリダイレクトする
- 画面の文言はすべて辞書（`src/lib/i18n/messages/en.ts`、`ja.ts`）から取る。`useMessages()` でプロパティとして参照する
  - `en.ts` が正。`ja.ts` は `satisfies Messages` で、キーの欠落・余剰や関数シグネチャの不一致が型エラーになる
  - 値に埋め込みがあるものは、引数付きの関数にする（例: `stepper.counter({ current, total })`）。大きな数値は `formatNumber(useLocale() で取ったロケール, 値)` で整形する
- JSX への文字列の直書きは `react/jsx-no-literals` でエラーになる。ただし属性値（`aria-label`、`alt`、`title`、`placeholder` など）は lint では検出できないので、属性値の文言も必ず辞書から取る
- シナリオ・クイズの文章は `LocalizedText`（`{ en, ja }`）としてデータに直接持たせ、表示時に `useText()` で解決する
- 型が `LocalizedText` なら翻訳する、`ProtocolTerm`（`SYN`、`ClientHello`、`QNAME` など。`engine/types.ts` に定義予定）なら翻訳しない
- リンクは `localePath(locale, path)` でロケール付きのパスを作る

## 学習コンテンツの正確性

- 技術的な内容の誤りは学習サイトとして致命的。シナリオの定義には根拠となる RFC の参照をコメントで残す（TCP: RFC 9293、DNS: RFC 1034/1035、TLS 1.3: RFC 8446、証明書: RFC 5280）
- seq/ack の値やメッセージの順序などはテストで固定する

## テスト

- テストはテスト対象と同じディレクトリに `*.test.ts(x)` で置く。`describe` / `it` / `expect` は `vitest` から明示的に import する（globals なし）
- DOM を使わない純関数のテストは、ファイル先頭に `// @vitest-environment node` を付ける（速くなる）
- `src/test/setup.ts` がテストごとに `cleanup()` と `localStorage.clear()` を行う
- ルーティングのテストは `MemoryRouter` を使う（Vitest は `base` を `/` に上書きするため）。basename 付きの経路は `BrowserRouter basename="/NetworkStudy/"` で個別に確認する
- ブラウザの言語は `vi.spyOn(navigator, 'languages', 'get')` で差し替える
- Radix の Tooltip / Sheet / Slider などを開くテストでは、`ResizeObserver` などの polyfill を `src/test/setup.ts` に追加する必要がある

## 静的ページ生成（scripts/）

- GitHub Pages には SPA 用のフォールバックがないため、`build` の最後に「ロケール × ルート」と「ロケールなし × ルート」の `index.html`、および `404.html` を生成する（`lang`・`title`・`description`・`hreflang`、ロケール付きのページには `canonical` も埋め込む）
- テーマを追加したら `src/content/themeIds.ts` に ID を足す（英小文字・数字・ハイフンのみ）。静的ページも自動で増える
- scripts は `tsconfig.scripts.json`（DOM なし）で型チェックされる。scripts から import してよい src は、DOM や `import.meta.env` に依存しないモジュール（`content/themeIds.ts`、`lib/i18n/locale.ts`、`lib/i18n/messages/`）に限る

## 開発フロー

- GitHub Flow。ブランチは `feature/<issue番号>-<概要>`、`fix/<issue番号>-<概要>`、`docs/<概要>` など
- コミットメッセージは Conventional Commits（`feat(i18n): …`）
- コミット前に `npm run format` を実行する（CI の `format:check` で落ちるため）
- PR の本文は `.github/pull_request_template.md` に沿う（画面を変えたら en / ja の両方を確認、学習コンテンツを変えたら根拠の RFC を確認）
- main はブランチ保護されている（PR 必須、`Check` が必須、Squash merge のみ）
