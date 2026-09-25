// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { escapeHtml, outputPath, pageUrl, renderNotFound, renderPage, renderSitemap } from './lib'

const SITE = 'https://example.github.io/NetworkStudy/'
const COMMON = {
  siteUrl: SITE,
  siteName: 'NetworkStudy',
  ogImage: { path: 'og.png', width: 1200, height: 630 },
} as const

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title>NetworkStudy</title>
    <script type="module" crossorigin src="/NetworkStudy/assets/index.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

describe('pageUrl', () => {
  it.each([
    [null, '', SITE],
    ['en', '', `${SITE}en/`],
    ['ja', 'themes/tcp', `${SITE}ja/themes/tcp/`],
    [null, 'themes/tcp', `${SITE}themes/tcp/`],
  ] as const)('%s + %j → %s', (locale, route, expected) => {
    expect(pageUrl(SITE, locale, route)).toBe(expected)
  })
})

describe('outputPath', () => {
  it('ロケールとルートからファイルパスを作る', () => {
    expect(outputPath('en', '')).toBe('en/index.html')
    expect(outputPath('ja', 'themes/tcp')).toBe('ja/themes/tcp/index.html')
    expect(outputPath(null, '')).toBe('index.html')
    expect(outputPath(null, 'themes/tcp')).toBe('themes/tcp/index.html')
  })
})

describe('escapeHtml', () => {
  it('HTML の特殊文字をエスケープする', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    )
  })
})

describe('renderPage', () => {
  const html = renderPage(TEMPLATE, {
    ...COMMON,
    locales: ['en', 'ja'],
    locale: 'ja',
    route: 'themes/tcp',
    meta: { lang: 'ja', title: 'TCP & <handshake>', description: '説明 "quoted"' },
  })

  it('<html lang> と <title> を差し替える（エスケープ付き）', () => {
    expect(html).toContain('<html lang="ja">')
    expect(html).not.toContain('<html lang="en">')
    expect(html).toContain('<title>TCP &amp; &lt;handshake&gt;</title>')
  })

  it('description・canonical・hreflang を head に入れる', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('<meta name="description" content="説明 &quot;quoted&quot;" />')
    expect(head).toContain(`<link rel="canonical" href="${SITE}ja/themes/tcp/" />`)
    expect(head).toContain(`<link rel="alternate" hreflang="en" href="${SITE}en/themes/tcp/" />`)
    expect(head).toContain(`<link rel="alternate" hreflang="ja" href="${SITE}ja/themes/tcp/" />`)
    expect(head).toContain(
      `<link rel="alternate" hreflang="x-default" href="${SITE}themes/tcp/" />`,
    )
  })

  it('言語別の Open Graph と Twitter カードを入れる', () => {
    expect(html).toContain('<meta property="og:title" content="TCP &amp; &lt;handshake&gt;" />')
    expect(html).toContain(`<meta property="og:url" content="${SITE}ja/themes/tcp/" />`)
    expect(html).toContain('<meta property="og:locale" content="ja_JP" />')
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US" />')
    expect(html).toContain(`<meta property="og:image" content="${SITE}og.png" />`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('アセットの参照はそのまま残す', () => {
    expect(html).toContain('src="/NetworkStudy/assets/index.js"')
  })

  it('ルートのリダイレクト用ページには canonical を付けない', () => {
    const root = renderPage(TEMPLATE, {
      ...COMMON,
      locales: ['en', 'ja'],
      locale: null,
      route: '',
      meta: { lang: 'en', title: 'NetworkStudy', description: 'd' },
    })
    expect(root).not.toContain('rel="canonical"')
    expect(root).toContain(`hreflang="x-default" href="${SITE}"`)
  })

  it('加工済みの HTML をテンプレートに渡すと例外を投げる（再実行でタグが重複しないように）', () => {
    expect(() =>
      renderPage(html, {
        ...COMMON,
        locales: ['en', 'ja'],
        locale: 'en',
        route: '',
        meta: { lang: 'en', title: 't', description: 'd' },
      }),
    ).toThrow(/加工されています/)
    expect(() => renderNotFound(renderNotFound(TEMPLATE))).toThrow(/加工されています/)
  })

  it('テンプレートに必要な要素がなければ例外を投げる', () => {
    expect(() =>
      renderPage('<html><head></head></html>', {
        ...COMMON,
        locales: ['en'],
        locale: 'en',
        route: '',
        meta: { lang: 'en', title: 't', description: 'd' },
      }),
    ).toThrow(/<html lang>/)
  })
})

describe('renderNotFound', () => {
  it('noindex を付ける', () => {
    expect(renderNotFound(TEMPLATE)).toContain(
      '<meta name="robots" content="noindex" />\n  </head>',
    )
  })
})

describe('renderSitemap', () => {
  it('ロケール付きのページを載せ、hreflang の対応を付ける', () => {
    const xml = renderSitemap(SITE, ['en', 'ja'], ['', 'themes/tcp'])
    expect(xml.match(/<loc>/g)).toHaveLength(4)
    expect(xml).toContain(`<loc>${SITE}ja/themes/tcp/</loc>`)
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}themes/tcp/" />`,
    )
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })
})
