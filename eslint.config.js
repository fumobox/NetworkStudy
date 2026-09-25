import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // 型アサーションは禁止（`as const` のみ許可）。やむを得ない場合は理由をコメントして disable する
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // scripts は Node で実行する
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // 多言語対応のため、画面の文言は辞書から取得する（JSX への文字列の直書きを禁止）
    files: [
      'src/*.tsx',
      'src/pages/**/*.tsx',
      'src/components/**/*.tsx',
      'src/engine/**/*.tsx',
      'src/app/**/*.tsx',
    ],
    ignores: ['src/components/ui/**', '**/*.test.tsx', 'src/test/**'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: ['/', '·', '→', '←', '×', '✓', '✗', ':', '(', ')', '-'],
        },
      ],
    },
  },
  {
    // shadcn/ui の生成コードは variants などをコンポーネントと一緒に export する
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  prettier,
])
