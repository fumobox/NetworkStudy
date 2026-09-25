# NetworkStudy

ネットワークプロトコル（TCP、DNS、TLS 1.3 など）の動きを、1 パケットずつ進めて学ぶインタラクティブな学習サイト。英語と日本語に対応した静的 SPA で、GitHub Pages（https://fumobox.github.io/NetworkStudy/）で配信する。

計画・ロードマップは [docs/PLAN.md](docs/PLAN.md)、シーケンスエンジンの設計は [docs/design/engine.md](docs/design/engine.md) を参照。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（`http://localhost:5173/NetworkStudy/`） |
| `npm run build` | 型チェック → vite build → 静的ページ生成（`dist/`） |
| `npm run preview` | ビルド結果の確認 |
| `npm run typecheck` | `tsc -b`（app / node / scripts / e2e の各 tsconfig） |
| `npm run lint` / `lint:fix` | ESLint（警告も失敗扱い）/ 自動修正 |
| `npm run depcruise` | 循環依存とレイヤ違反のチェック |
| `npm run format` / `format:check` | Prettier |
| `npm test` / `test:run` / `test:coverage` | Vitest |
| `npm run pages:verify` | 生成した静的ページの検証（`build` の後に実行） |
| `npm run e2e` | Playwright のスモークテストと axe によるアクセシビリティのチェック（`build` の後に実行。初回は `npx playwright install chromium`） |
| `npm run lhci` | Lighthouse CI（`build` の後に実行。sitemap.xml の全ページでアクセシビリティ 90 以上。レポートは `lhci-report/`） |

CI（`.github/workflows/ci.yml` の `Check` job）は typecheck → lint → depcruise → format:check → test:run → build → pages:verify → e2e → lhci の順に実行する。main への push では、その後 `Deploy` job が GitHub Pages へデプロイする。

## 技術スタック

React 19 / Vite 8 / TypeScript 6（strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）/ Tailwind CSS v4 / shadcn/ui（Radix、Nova）/ React Router 8（宣言的モード）/ zod 4 / Motion 13 / Vitest 5。Node 24。

Motion は `LazyMotion`（`domAnimation`、strict）で読み込んでいるので、`motion.*` ではなく `m.*` を使う。`LazyMotion` は ScenarioPlayer にあり、アニメーション機能はテーマのページのチャンクと一緒に同期的に読み込む（動的 import にすると初回のアニメーションが実行されない）。テーマのページ（ThemePage）は遅延読み込みで、ホームはメタ情報とクイズだけの `content/quizzes.ts` を使う

## ディレクトリとレイヤ

```
src/
├── app/            ルーティング（AppRoutes, LocaleLayout, LocaleRedirect）
├── pages/          ページ
├── components/
│   ├── ui/         shadcn/ui の生成コード
│   ├── layout/     AppLayout, Header, Footer, LanguageSwitcher
│   └── features/   クイズ（quiz/）、テーマカード（theme-card/）、概要（overview/）
├── content/        テーマごとのシナリオ・クイズ（themeMeta.ts にメタ情報、registry.ts に登録、quizzes.ts にホーム用のメタ情報とクイズ）
├── engine/         シーケンスエンジン（型・導出・検証・プレイヤー・UI）
├── lib/            汎用処理（i18n/, hooks/, storage.ts, utils.ts）
├── types/          横断的な型（DeepReadonly など）
└── test/setup.ts
scripts/            ビルド後の静的ページ生成・検証（tsx で実行）
e2e/                Playwright のスモークテストとアクセシビリティのチェック（axe）
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
- `shadcn add` で追加したコンポーネントは、`exactOptionalPropertyTypes` で型エラーになることがある。そのときは最小限の手修正をし、理由をコメントに残す（例: `slider.tsx`）。生成コードのバグを直した場合も同様にコメントを残す（例: `tabs.tsx` の `orientation`、`slider.tsx` のつまみの `aria-label`）
- eslint-plugin-react-hooks v7 の recommended（React Compiler 系のルールを含む）は意図して有効にしている

## 多言語対応（i18n）

- 日本語の訳語と表記（長音、英数字の前後のスペース、翻訳しない用語）は [docs/glossary.md](docs/glossary.md) に従う。機械的に確かめられる規則は `src/content/glossary.test.tsx` で検査している
- URL は常に `/:locale/...`（`en` / `ja`）。ロケールのないパスは `LocaleRedirect` がリダイレクトする
- 画面の文言はすべて辞書（`src/lib/i18n/messages/en.ts`、`ja.ts`）から取る。`useMessages()` でプロパティとして参照する
  - `en.ts` が正。`ja.ts` は `satisfies Messages` で、キーの欠落・余剰や関数シグネチャの不一致が型エラーになる
  - 値に埋め込みがあるものは、引数付きの関数にする（例: `stepper.counter({ current, total })`）。大きな数値は `formatNumber(useLocale() で取ったロケール, 値)` で整形する
- JSX への文字列の直書きは `react/jsx-no-literals` でエラーになる。ただし属性値（`aria-label`、`alt`、`title`、`placeholder` など）は lint では検出できないので、属性値の文言も必ず辞書から取る
- シナリオ・クイズの文章は `LocalizedText`（`{ en, ja }`）としてデータに直接持たせ、表示時に `useText()` で解決する
- 型が `LocalizedText` なら翻訳する、`ProtocolTerm`（`SYN`、`ClientHello`、`QNAME` など。`engine/types.ts` に定義予定）なら翻訳しない
- リンクは `localePath(locale, path)` でロケール付きのパスを作る
- テーマの概要は `src/content/<theme>/overview.{en,ja}.mdx` に書き、`index.ts` の `overview` に `lazy` で登録する。見出しは h2（`##`）から始める（ページの h1 はテーマ名）。MDX の文言は lint で検査されないので、英日の内容の差はレビューで確認する。日本語では `**…）**で` のように全角の記号の直後で強調を閉じると太字にならない（CommonMark の規則）ので、記号は強調の外に出す

## 学習コンテンツの正確性

- 技術的な内容の誤りは学習サイトとして致命的。シナリオの定義には根拠となる RFC の参照をコメントで残す（TCP: RFC 9293、DNS: RFC 1034/1035、TLS 1.3: RFC 8446、証明書: RFC 5280）
- seq/ack の値やメッセージの順序などはテストで固定する

## テスト

- テストはテスト対象と同じディレクトリに `*.test.ts(x)` で置く。`describe` / `it` / `expect` は `vitest` から明示的に import する（globals なし）
- DOM を使わない純関数のテストは、ファイル先頭に `// @vitest-environment node` を付ける（速くなる）
- `src/test/setup.ts` がテストごとに `cleanup()` と `localStorage.clear()` を行う
- ルーティングのテストは `MemoryRouter` を使う（Vitest は `base` を `/` に上書きするため）。basename 付きの経路は `BrowserRouter basename="/NetworkStudy/"` で個別に確認する
- ブラウザの言語は `vi.spyOn(navigator, 'languages', 'get')` で差し替える
- Radix が使う `ResizeObserver`・pointer capture・`scrollIntoView` は `src/test/setup.ts` で補っている。足りない API があればそこに追加する
- e2e（`e2e/*.spec.ts`）はスモークのみ（各テーマ × 各ロケールで最終ステップまで進める、直リンク、言語切替、404）。挙動の検証は Vitest で行う。ビルド済みの `dist` を `vite preview` で配信して確かめる。テーマ一覧と文言は `themeMeta.ts` と辞書から取り、テーマを足すと自動で対象になる。e2e から import してよい src は scripts と同じ（DOM 非依存のモジュールのみ）
- `e2e/a11y.spec.ts` は axe で WCAG 2.1 A / AA の違反がないことを、明暗の両方の配色で確かめる（各ページの初期表示・最終ステップ・What-if 変更後・クイズの回答後）。色を変えたら e2e で確かめる。shadcn の既定の `--muted-foreground` はライトモードの `bg-accent` 上でコントラストが足りないので、`src/index.css` で暗くしている

## 静的ページ生成（scripts/）

- GitHub Pages には SPA 用のフォールバックがないため、`build` の最後に「ロケール × ルート」と「ロケールなし × ルート」の `index.html`、および `404.html` を生成する（`lang`・`title`・`description`・`hreflang`、ロケール付きのページには `canonical` も埋め込む）
- テーマを追加したら `src/content/themeMeta.ts` にメタ情報（id は英小文字・数字・ハイフンのみ）を足し、`src/content/registry.ts` に登録し、`src/content/quizzes.ts` の `THEME_QUIZZES` にもメタ情報とクイズを足す（順序は registry と同じ。registry.test.ts で確かめる）。静的ページも e2e の対象も自動で増える
- テーマには種類（`kind`）がある。`ThemeModule` は `kind` で判別する共用体（`src/content/types.ts`）で、メタ情報の `kind` と同じ値にする（型で強制される）。どの種類にも概要（MDX）とクイズが必要
  - `sequence`: シーケンスエンジンを使う（`SequenceThemeModule`。`scenario` と、必要なら `panels`）。e2e は最終ステップまで進める
  - `custom`: テーマ独自の UI を持つ（`CustomThemeModule`。`body` に `lazy` で本体のコンポーネントを渡す）。ThemePage は概要とクイズの間に `body` を表示する。e2e はページが開くことだけ確かめるので、操作のテストは各テーマで書く
- 各ページに Open Graph と Twitter カードを入れ、`sitemap.xml`（hreflang 付き）も生成する。OG 画像は `public/og.png` で、元の HTML は `scripts/og/og.html`（作り直し方はそのファイルの先頭に書いてある）。robots.txt はプロジェクトサイトでは効かないので置かない
- scripts は `tsconfig.scripts.json`（DOM なし）で型チェックされる。scripts から import してよい src は、DOM や `import.meta.env` に依存しないモジュール（`content/themeMeta.ts`、`lib/i18n/locale.ts`、`lib/i18n/messages/`）に限る

## 開発フロー

- GitHub Flow。ブランチは `feature/<issue番号>-<概要>`、`fix/<issue番号>-<概要>`、`docs/<概要>` など
- コミットメッセージは Conventional Commits（`feat(i18n): …`）
- コミット前に `npm run format` を実行する（CI の `format:check` で落ちるため）
- PR の本文は `.github/pull_request_template.md` に沿う（画面を変えたら en / ja の両方を確認、学習コンテンツを変えたら根拠の RFC を確認）
- main はブランチ保護されている（PR 必須、`Check` が必須、Squash merge のみ）
