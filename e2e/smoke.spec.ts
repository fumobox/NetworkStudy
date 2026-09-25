import { expect, test } from '@playwright/test'
import { THEME_META } from '@/content/themeMeta'
import { LOCALES } from '@/lib/i18n/locale'
import { LOCALE_NAMES, MESSAGES } from '@/lib/i18n/messages'

// スモークテスト: 本番と同じビルドで、各ページが開いて最後まで操作できることだけを確かめる（挙動の詳細は Vitest で確かめる）

/** 「ステップ N / M」の文言に一致する正規表現（辞書から作り、文言の変更に追従する） */
function counterPattern(counter: (p: { current: number; total: number }) => string): RegExp {
  const escaped = counter({ current: 111111, total: 222222 }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace('111111', '\\d+').replace('222222', '\\d+')}$`)
}

for (const locale of LOCALES) {
  const m = MESSAGES[locale]

  test(`ホームに全テーマのカードがある（${locale}）`, async ({ page }) => {
    await page.goto(`${locale}/`)
    await expect(page.getByRole('heading', { level: 1, name: m.common.siteName })).toBeVisible()
    const cards = page.getByRole('region', { name: m.home.orderTitle }).getByRole('link')
    await expect(cards).toHaveText(THEME_META.map((meta) => meta.title[locale]))
    for (const [index, meta] of THEME_META.entries()) {
      await expect(cards.nth(index)).toHaveAttribute(
        'href',
        `/NetworkStudy/${locale}/themes/${meta.id}`,
      )
    }
  })

  for (const meta of THEME_META) {
    test(`${meta.id} を最終ステップまで進める（${locale}）`, async ({ page }) => {
      await page.goto(`${locale}/themes/${meta.id}`)
      await expect(page.getByRole('heading', { level: 1, name: meta.title[locale] })).toBeVisible()
      const next = page.getByRole('button', { name: m.stepper.next, exact: true })
      const counter = page.getByText(counterPattern(m.stepper.counter))
      const total = Number((await counter.textContent())?.match(/(\d+)\D*$/)?.[1])
      expect(total).toBeGreaterThan(1)
      for (let step = 2; step <= total; step++) {
        await next.click()
        await expect(counter).toHaveText(m.stepper.counter({ current: step, total }))
      }
      await expect(next).toBeDisabled()
      await expect(page).toHaveURL(new RegExp(`[?&]step=${String(total)}$`))
    })
  }
}

test('?opt.* と ?step= の直リンクで、そのステップから始まる', async ({ page }) => {
  await page.goto('ja/themes/tcp-handshake?opt.serverPort=closed&step=3')
  await expect(page.getByText(MESSAGES.ja.stepper.counter({ current: 3, total: 4 }))).toBeVisible()
  await expect(
    page.getByRole('radio', { name: '閉じている（誰も待ち受けていない）' }),
  ).toBeChecked()
})

test('言語を切り替えても、パスとクエリを保つ', async ({ page }) => {
  await page.goto('en/themes/tcp-handshake?step=2')
  await page
    .getByRole('navigation', { name: MESSAGES.en.language.label })
    .getByRole('link', { name: LOCALE_NAMES.ja })
    .click()
  await expect(page).toHaveURL(/\/NetworkStudy\/ja\/themes\/tcp-handshake\?step=2$/)
  await expect(page.getByText(MESSAGES.ja.stepper.counter({ current: 2, total: 5 }))).toBeVisible()
})

test('ロケールのないパスは、ロケール付きのパスへ移る', async ({ page }) => {
  await page.goto('themes/dns-resolution')
  await expect(page).toHaveURL(/\/NetworkStudy\/(en|ja)\/themes\/dns-resolution$/)
})

test('未知のパスは 404 のページを表示する', async ({ page }) => {
  await page.goto('en/no-such-page')
  await expect(page.getByRole('heading', { name: MESSAGES.en.notFound.title })).toBeVisible()
})
