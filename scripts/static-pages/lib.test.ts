// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { escapeHtml, outputPath, pageUrl, renderNotFound, renderPage, routesFor } from './lib'

const SITE = 'https://example.github.io/NetworkStudy/'

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

describe('routesFor', () => {
  it('ホームとテーマのルートを返す', () => {
    expect(routesFor([])).toEqual([''])
    expect(routesFor(['tcp', 'dns'])).toEqual(['', 'themes/tcp', 'themes/dns'])
  })
})

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
    siteUrl: SITE,
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

  it('アセットの参照はそのまま残す', () => {
    expect(html).toContain('src="/NetworkStudy/assets/index.js"')
  })

  it('ルートのリダイレクト用ページには canonical を付けない', () => {
    const root = renderPage(TEMPLATE, {
      siteUrl: SITE,
      locales: ['en', 'ja'],
      locale: null,
      route: '',
      meta: { lang: 'en', title: 'NetworkStudy', description: 'd' },
    })
    expect(root).not.toContain('rel="canonical"')
    expect(root).toContain(`hreflang="x-default" href="${SITE}"`)
  })

  it('テンプレートに必要な要素がなければ例外を投げる', () => {
    expect(() =>
      renderPage('<html><head></head></html>', {
        siteUrl: SITE,
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
