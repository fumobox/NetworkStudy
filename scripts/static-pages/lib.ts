import type { Locale } from '@/lib/i18n/locale'

export interface PageMeta {
  lang: Locale
  title: string
  description: string
}

/** OG の og:locale の値 */
const OG_LOCALES: Readonly<Record<Locale, string>> = { en: 'en_US', ja: 'ja_JP' }

interface RenderOptions {
  siteUrl: string
  siteName: string
  ogImage: { readonly path: string; readonly width: number; readonly height: number }
  locales: readonly Locale[]
  /** ロケール付きのページなら そのロケール、ルートのリダイレクト用ページなら null */
  locale: Locale | null
  /** ロケールより後ろのパス。ホームは空文字、テーマは `themes/<id>` */
  route: string
  meta: PageMeta
}

/**
 * ページの公開 URL。GitHub Pages のディレクトリの正規形に合わせて末尾スラッシュ付きにする。
 * `pageUrl(site, 'ja', 'themes/tcp')` → `https://…/NetworkStudy/ja/themes/tcp/`
 */
export function pageUrl(siteUrl: string, locale: Locale | null, route: string): string {
  const path = [locale ?? '', route].filter((segment) => segment !== '').join('/')
  return path === '' ? siteUrl : `${siteUrl}${path}/`
}

/**
 * dist からの出力先の相対パス。`outputPath('ja', 'themes/tcp')` → `ja/themes/tcp/index.html`、
 * ロケールなしのリダイレクト用ページは `outputPath(null, 'themes/tcp')` → `themes/tcp/index.html`
 */
export function outputPath(locale: Locale | null, route: string): string {
  return [locale ?? '', route, 'index.html'].filter((segment) => segment !== '').join('/')
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(html)) {
    throw new Error(`index.html に ${label} が見つかりません`)
  }
  return html.replace(pattern, replacement)
}

/** 生成時に挿入するタグ。テンプレートにすでに含まれていれば、加工済みの HTML を渡されたとみなす */
const GENERATED_MARKERS = [
  'name="description"',
  'rel="canonical"',
  'rel="alternate"',
  'name="robots"',
  'property="og:',
  'name="twitter:',
]

function assertPristine(template: string): void {
  const found = GENERATED_MARKERS.filter((marker) => template.includes(marker))
  if (found.length > 0) {
    throw new Error(
      `index.html がすでに加工されています（${found.join(', ')}）。vite build からやり直してください`,
    )
  }
}

/** ビルド済みの index.html をもとに、ロケール・ルートごとの HTML を作る */
export function renderPage(template: string, options: RenderOptions): string {
  const { siteUrl, siteName, ogImage, locales, locale, route, meta } = options
  assertPristine(template)
  const url = pageUrl(siteUrl, locale, route)
  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)

  const headTags = [
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    ...(locale === null
      ? []
      : [`<link rel="canonical" href="${pageUrl(siteUrl, locale, route)}" />`]),
    ...locales.map(
      (alternate) =>
        `<link rel="alternate" hreflang="${alternate}" href="${pageUrl(siteUrl, alternate, route)}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl(siteUrl, null, route)}" />`,
    // SNS で共有されたときの表示（Open Graph と Twitter カード）
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${OG_LOCALES[meta.lang]}" />`,
    ...locales
      .filter((alternate) => alternate !== meta.lang)
      .map(
        (alternate) => `<meta property="og:locale:alternate" content="${OG_LOCALES[alternate]}" />`,
      ),
    `<meta property="og:image" content="${siteUrl}${ogImage.path}" />`,
    `<meta property="og:image:width" content="${String(ogImage.width)}" />`,
    `<meta property="og:image:height" content="${String(ogImage.height)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ]

  let html = replaceOnce(
    template,
    /<html lang="[^"]*">/,
    `<html lang="${meta.lang}">`,
    '<html lang>',
  )
  html = replaceOnce(
    html,
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(meta.title)}</title>`,
    '<title>',
  )
  html = replaceOnce(html, / *<\/head>/, `    ${headTags.join('\n    ')}\n  </head>`, '</head>')
  return html
}

/** 未知のパス用の 404.html。SPA のエントリと同じ内容に noindex を付ける */
export function renderNotFound(template: string): string {
  assertPristine(template)
  return replaceOnce(
    template,
    / *<\/head>/,
    '    <meta name="robots" content="noindex" />\n  </head>',
    '</head>',
  )
}

/** sitemap.xml を作る。ロケール付きのページだけを載せ、各 URL に hreflang の対応を付ける */
export function renderSitemap(
  siteUrl: string,
  locales: readonly Locale[],
  routes: readonly string[],
): string {
  const urls = routes.flatMap((route) =>
    locales.map((locale) => {
      const alternates = [
        ...locales.map(
          (alternate) =>
            `    <xhtml:link rel="alternate" hreflang="${alternate}" href="${pageUrl(siteUrl, alternate, route)}" />`,
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(siteUrl, null, route)}" />`,
      ]
      return [
        '  <url>',
        `    <loc>${pageUrl(siteUrl, locale, route)}</loc>`,
        ...alternates,
        '  </url>',
      ].join('\n')
    }),
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
