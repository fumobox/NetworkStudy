import type { Locale } from '@/lib/i18n/locale'

export interface PageMeta {
  lang: Locale
  title: string
  description: string
}

interface RenderOptions {
  siteUrl: string
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
  const { siteUrl, locales, locale, route, meta } = options
  assertPristine(template)

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
