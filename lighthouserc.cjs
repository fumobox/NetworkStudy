// Lighthouse CI。ビルド済みの dist を vite preview で配信し、sitemap.xml の中の代表のページを確かめる（先に `npm run build` を実行する）。
// 完了条件はアクセシビリティ 90 以上（error）。ベストプラクティスと SEO は warn にとどめ、パフォーマンスは CI では計測値がぶれるので測らない。
// 全ページだと 1 URL 約 11 秒でテーマとともに伸びるので、種類ごとに 1 ページ（ホーム、シーケンスのテーマ、独自の UI のテーマ、学習の道筋）× 各ロケールに絞る。
// アクセシビリティは e2e/a11y.spec.ts の axe が全ページを明暗の両方で確かめている（Lighthouse のアクセシビリティも axe が元）
const { readFileSync } = require('node:fs')

const PORT = 4174
const SITE_URL = 'https://fumobox.github.io'

const LOCALES = ['en', 'ja']
const PAGES = ['', 'themes/tcp-handshake/', 'themes/subnet-calculator/', 'paths/web-developer/']

const sitemap = [...readFileSync('dist/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  ([, loc]) => loc,
)
const wanted = LOCALES.flatMap((locale) =>
  PAGES.map((page) => `${SITE_URL}/NetworkStudy/${locale}/${page}`),
)
// テーマや道筋の id が変わったら、黙って対象が減らないよう止める
const missing = wanted.filter((url) => !sitemap.includes(url))
if (missing.length > 0) {
  throw new Error(
    `dist/sitemap.xml にない（先に npm run build を実行する。id を変えたら PAGES も直す）: ${missing.join(', ')}`,
  )
}
const urls = wanted.map((url) => url.replace(SITE_URL, `http://localhost:${String(PORT)}`))

module.exports = {
  ci: {
    collect: {
      startServerCommand: `npm run preview -- --port ${String(PORT)} --strictPort`,
      startServerReadyPattern: 'Local',
      url: urls,
      numberOfRuns: 1,
      settings: {
        onlyCategories: ['accessibility', 'best-practices', 'seo'],
        chromeFlags: '--headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: 'lhci-report',
    },
  },
}
