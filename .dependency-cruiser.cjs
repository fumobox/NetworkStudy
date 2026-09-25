/**
 * レイヤの依存方向: pages / app → content → engine → lib
 * components/ui（shadcn）はどのレイヤからも使えるが、自身は lib 以外に依存しない。
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循環依存は禁止。共通部分を別モジュールに抽出して依存を一方向にする',
      from: {},
      to: { circular: true },
    },
    {
      name: 'lib-is-leaf',
      severity: 'error',
      comment: 'lib は汎用処理のみ。他のレイヤに依存しない',
      from: { path: '^src/lib/' },
      to: { path: '^src/(app|pages|content|engine|components|hooks)/' },
    },
    {
      name: 'engine-independent-of-content',
      severity: 'error',
      comment: 'engine は content・pages・アプリ固有のコンポーネントに依存しない',
      from: { path: '^src/engine/' },
      to: { path: '^src/(app|pages|content|components/(layout|features))/' },
    },
    {
      name: 'content-below-pages',
      severity: 'error',
      comment: 'content は pages・app・layout に依存しない',
      from: { path: '^src/content/' },
      to: { path: '^src/(app|pages|components/layout)/' },
    },
    {
      name: 'ui-is-primitive',
      severity: 'error',
      comment: 'components/ui は lib 以外のアプリコードに依存しない',
      from: { path: '^src/components/ui/' },
      to: { path: '^src/(app|pages|content|engine|components/(layout|features))/' },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-dev-deps-at-runtime',
      severity: 'error',
      comment: 'アプリのコードから devDependencies を import しない（テストは除く）',
      from: { path: '^src/', pathNot: '\\.test\\.tsx?$|^src/test/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.d.ts'],
    },
  },
}
