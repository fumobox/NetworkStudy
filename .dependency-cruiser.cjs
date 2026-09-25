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
      to: { path: '^src/', pathNot: '^src/(lib|types)/' },
    },
    {
      name: 'engine-independent-of-content',
      severity: 'error',
      comment:
        'engine は lib・types・components/ui にのみ依存する（content・pages などには依存しない）',
      from: { path: '^src/engine/' },
      to: { path: '^src/', pathNot: '^src/(lib|types|engine|components/ui)/' },
    },
    {
      name: 'content-below-pages',
      severity: 'error',
      comment:
        'content は engine 以下と共通部品にのみ依存する（pages・app・layout には依存しない）',
      from: { path: '^src/content/' },
      to: {
        path: '^src/',
        pathNot: '^src/(lib|types|hooks|engine|content|components/(ui|features))/',
      },
    },
    {
      name: 'ui-is-primitive',
      severity: 'error',
      comment: 'components/ui は lib 以外のアプリコードに依存しない',
      from: { path: '^src/components/ui/' },
      to: { path: '^src/', pathNot: '^src/(lib|components/ui)/' },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'package.json に記載のないパッケージ（推移的依存など）を直接 import しない',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
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
