// Lighthouse CI。ビルド済みの dist を vite preview で配信し、sitemap.xml の全ページを確かめる（先に `npm run build` を実行する）。
// 完了条件はアクセシビリティ 90 以上（error）。ベストプラクティスと SEO は warn にとどめ、パフォーマンスは CI では計測値がぶれるので測らない
const { readFileSync } = require('node:fs')

const PORT = 4174
const SITE_URL = 'https://fumobox.github.io'

const urls = [...readFileSync('dist/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  ([, loc]) => loc.replace(SITE_URL, `http://localhost:${String(PORT)}`),
)
if (urls.length === 0) {
  throw new Error('dist/sitemap.xml にページがない（先に npm run build を実行する）')
}

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
