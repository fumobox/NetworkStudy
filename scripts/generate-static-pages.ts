/**
 * ビルド後に、ロケール × ルートごとの index.html と 404.html を dist に生成する。
 * GitHub Pages には SPA 用のフォールバックがないため、直リンクでも 200 で返せるようにする。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LOCALES } from '@/lib/i18n/locale'
import { renderNotFound, renderPage, renderSitemap } from './static-pages/lib'
import { plannedPages } from './static-pages/pages'
import { OG_IMAGE, SITE_NAME, SITE_URL } from './static-pages/site'

const distDir = path.resolve(import.meta.dirname, '..', 'dist')
const template = await readFile(path.join(distDir, 'index.html'), 'utf8')

for (const page of plannedPages()) {
  const html = renderPage(template, {
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
    ogImage: OG_IMAGE,
    locales: LOCALES,
    locale: page.locale,
    route: page.route,
    meta: page.meta,
  })
  const file = path.join(distDir, page.file)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, html)
  console.log(`generated ${page.file}`)
}

await writeFile(path.join(distDir, '404.html'), renderNotFound(template))
console.log('generated 404.html')

const routes = [...new Set(plannedPages().map((page) => page.route))]
await writeFile(path.join(distDir, 'sitemap.xml'), renderSitemap(SITE_URL, LOCALES, routes))
console.log('generated sitemap.xml')
