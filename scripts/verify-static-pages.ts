/**
 * 生成した静的ページを検証する。CI で実行する。
 * 生成側のロジックに依存しないよう、期待値は dist の実ファイルのパスから導き出す。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_LOCALE, isLocale, LOCALES } from '@/lib/i18n/locale'
import { plannedPages } from './static-pages/pages'
import { BASE_PATH, OG_IMAGE, SITE_URL } from './static-pages/site'

const distDir = path.resolve(import.meta.dirname, '..', 'dist')
const failures: string[] = []

function fail(file: string, message: string): void {
  failures.push(`${file}: ${message}`)
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readDist(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(distDir, file), 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      fail(file, 'ファイルがない')
      return null
    }
    throw error
  }
}

function count(html: string, pattern: RegExp): number {
  return html.match(new RegExp(pattern.source, 'g'))?.length ?? 0
}

function expectCount(file: string, html: string, pattern: RegExp, expected: number, label: string) {
  const actual = count(html, pattern)
  if (actual !== expected) {
    fail(file, `${label} が ${String(actual)} 個ある（期待値 ${String(expected)}）`)
  }
}

/** `ja/themes/tcp/index.html` → { locale: 'ja', route: 'themes/tcp' }、`themes/tcp/index.html` → { locale: null, … } */
function parsePagePath(file: string) {
  const segments = path.posix
    .dirname(file)
    .split('/')
    .filter((s) => s !== '.' && s !== '')
  const [first, ...rest] = segments
  return isLocale(first)
    ? { locale: first, route: rest.join('/') }
    : { locale: null, route: segments.join('/') }
}

function urlFor(locale: string | null, route: string): string {
  const pathPart = [locale ?? '', route].filter((s) => s !== '').join('/')
  return pathPart === '' ? SITE_URL : `${SITE_URL}${pathPart}/`
}

const files = (await readdir(distDir, { recursive: true }))
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => file.endsWith('index.html'))
  .sort()
const fileSet = new Set(files)

// 生成されるべきページと実際のファイルの過不足
const planned = plannedPages()
  .map((page) => page.file)
  .sort()
for (const file of planned.filter((f) => !fileSet.has(f))) fail(file, 'ファイルがない')
for (const file of files.filter((f) => !planned.includes(f))) fail(file, '想定外のファイル')

// 参照先の URL が dist に実在するか
function checkHrefTarget(file: string, href: string): void {
  if (!href.startsWith(SITE_URL) || !href.endsWith('/')) {
    fail(file, `${href} がサイトのディレクトリ URL ではない`)
    return
  }
  const target = `${href.slice(SITE_URL.length)}index.html`
  if (!fileSet.has(target)) {
    fail(file, `${href} の参照先 ${target} が存在しない`)
  }
}

for (const file of files) {
  const html = await readDist(file)
  if (html === null) continue
  const { locale, route } = parsePagePath(file)

  expectCount(file, html, /<html lang="[^"]*">/, 1, '<html lang>')
  if (!html.includes(`<html lang="${locale ?? DEFAULT_LOCALE}">`)) {
    fail(file, `lang が ${locale ?? DEFAULT_LOCALE} ではない`)
  }
  expectCount(file, html, /<title>[^<]+<\/title>/, 1, '空でない <title>')
  expectCount(file, html, /<meta name="description" content="[^"]+" \/>/, 1, '空でない description')

  expectCount(file, html, /rel="canonical"/, locale === null ? 0 : 1, 'canonical')
  if (
    locale !== null &&
    !html.includes(`<link rel="canonical" href="${urlFor(locale, route)}" />`)
  ) {
    fail(file, `canonical が ${urlFor(locale, route)} ではない`)
  }

  for (const hreflang of [...LOCALES, 'x-default']) {
    expectCount(file, html, new RegExp(`hreflang="${hreflang}"`), 1, `hreflang="${hreflang}"`)
    const expected = urlFor(hreflang === 'x-default' ? null : hreflang, route)
    if (!html.includes(`hreflang="${hreflang}" href="${expected}"`)) {
      fail(file, `hreflang="${hreflang}" が ${expected} ではない`)
    }
  }
  for (const [, href = ''] of html.matchAll(
    /<link rel="(?:canonical|alternate)"[^>]* href="([^"]+)"/g,
  )) {
    checkHrefTarget(file, href)
  }

  if (!html.includes(`src="${BASE_PATH}assets/`)) {
    fail(file, `アセットが ${BASE_PATH}assets/ から読み込まれていない`)
  }

  // Open Graph と Twitter カード
  for (const property of [
    'og:type',
    'og:site_name',
    'og:title',
    'og:description',
    'og:url',
    'og:locale',
    'og:image',
  ]) {
    expectCount(file, html, new RegExp(`property="${property}" content="[^"]+"`), 1, property)
  }
  expectCount(file, html, /name="twitter:card" content="summary_large_image"/, 1, 'twitter:card')
  if (!html.includes(`<meta property="og:url" content="${urlFor(locale, route)}" />`)) {
    fail(file, `og:url が ${urlFor(locale, route)} ではない`)
  }
  if (!html.includes(`<meta property="og:image" content="${SITE_URL}${OG_IMAGE.path}" />`)) {
    fail(file, 'og:image の URL が違う')
  }
}

// OG 画像と sitemap.xml
try {
  await readFile(path.join(distDir, OG_IMAGE.path))
} catch {
  fail(OG_IMAGE.path, 'ファイルがない')
}
const sitemap = await readDist('sitemap.xml')
if (sitemap !== null) {
  const localized = files.filter((file) => parsePagePath(file).locale !== null)
  for (const file of localized) {
    const { locale, route } = parsePagePath(file)
    if (!sitemap.includes(`<loc>${urlFor(locale, route)}</loc>`)) {
      fail('sitemap.xml', `${urlFor(locale, route)} がない`)
    }
  }
  expectCount('sitemap.xml', sitemap, /<loc>/, localized.length, '<loc>')
}

const notFound = await readDist('404.html')
if (notFound !== null) {
  expectCount('404.html', notFound, /<meta name="robots" content="noindex" \/>/, 1, 'noindex')
  expectCount('404.html', notFound, /rel="(?:canonical|alternate)"/, 0, 'canonical / hreflang')
  if (!notFound.includes(`src="${BASE_PATH}assets/`)) {
    fail('404.html', `アセットが ${BASE_PATH}assets/ から読み込まれていない`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`verified ${String(files.length)} pages and 404.html`)
}
