/** 公開 URL（GitHub Pages のプロジェクトサイト）。vite.config.ts の base と一致させる */
export const SITE_URL = 'https://fumobox.github.io/NetworkStudy/'

/** vite.config.ts の base */
export const BASE_PATH = '/NetworkStudy/'

/** サイト名（OG の site_name。ブランド名なので翻訳しない） */
export const SITE_NAME = 'NetworkStudy'

/** OG 画像（public/og.png。元の HTML は scripts/og/og.html） */
export const OG_IMAGE = { path: 'og.png', width: 1200, height: 630 } as const
