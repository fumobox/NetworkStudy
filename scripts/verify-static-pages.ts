/** 生成した静的ページ（lang・canonical・hreflang・アセットのパス・404.html）を検証する。CI で実行する */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LOCALES } from '@/lib/i18n/locale'
import { pageUrl } from './static-pages/lib'
import { plannedPages } from './static-pages/pages'
import { BASE_PATH, SITE_URL } from './static-pages/site'

const distDir = path.resolve(import.meta.dirname, '..', 'dist')
const failures: string[] = []

async function read(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(distDir, file), 'utf8')
  } catch {
    failures.push(`${file}: ファイルがない`)
    return null
  }
}

function expectIncludes(file: string, html: string, snippet: string): void {
  if (!html.includes(snippet)) {
    failures.push(`${file}: ${snippet} が含まれていない`)
  }
}

for (const page of plannedPages()) {
  const html = await read(page.file)
  if (html === null) {
    continue
  }
  expectIncludes(page.file, html, `<html lang="${page.meta.lang}">`)
  if (page.locale !== null) {
    expectIncludes(
      page.file,
      html,
      `<link rel="canonical" href="${pageUrl(SITE_URL, page.locale, page.route)}" />`,
    )
  }
  for (const locale of LOCALES) {
    expectIncludes(
      page.file,
      html,
      `hreflang="${locale}" href="${pageUrl(SITE_URL, locale, page.route)}"`,
    )
  }
  expectIncludes(
    page.file,
    html,
    `hreflang="x-default" href="${pageUrl(SITE_URL, null, page.route)}"`,
  )
  expectIncludes(page.file, html, `src="${BASE_PATH}assets/`)
}

const notFound = await read('404.html')
if (notFound !== null) {
  expectIncludes('404.html', notFound, '<meta name="robots" content="noindex" />')
  expectIncludes('404.html', notFound, `src="${BASE_PATH}assets/`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`verified ${String(plannedPages().length)} pages and 404.html`)
}
