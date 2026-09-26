import { expect, test } from '@playwright/test'

// アニメーションが実際に動くことを、本番のビルドで確かめる（jsdom ではアニメーションが動かないため）。
// アニメーション機能を読み込み損ねると、要素が開始状態（透明）のまま残る（#52）

test('OSI: 付いたヘッダーと今の層の強調が、フェードして現れる', async ({ page }) => {
  await page.goto('en/themes/osi-model?step=4')
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await expect(page.locator('[data-unit="tcp"]')).toBeVisible()
  await next.click()

  const eth = page.locator('[data-unit="eth"]')
  const highlight = page.locator('li[aria-current="step"] > span').first()
  const opacity = (locator: typeof eth) =>
    locator.evaluate((element) => Number(getComputedStyle(element).opacity))

  // 直後は途中（半透明）で、しばらくすると不透明になる
  expect(await opacity(eth)).toBeLessThan(1)
  await expect.poll(() => opacity(eth)).toBe(1)
  await expect.poll(() => opacity(highlight)).toBe(1)
})

test('OSI: 視差効果を減らす設定では、すぐに表示する', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('en/themes/osi-model?step=4')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const eth = page.locator('[data-unit="eth"]')
  expect(await eth.evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1)
})
