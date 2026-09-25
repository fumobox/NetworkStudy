/**
 * 公開するテーマの ID 一覧（URL の `/:locale/themes/:id` に使う）。
 * 静的ページ生成スクリプト（scripts/generate-static-pages.ts）からも読み込むため、このファイルは他のモジュールを import しない。
 */
export const THEME_IDS = [] as const satisfies readonly string[]

export type ThemeId = (typeof THEME_IDS)[number]
