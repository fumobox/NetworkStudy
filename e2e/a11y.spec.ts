import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { THEME_META } from '@/content/themeMeta'
import { LOCALES } from '@/lib/i18n/locale'
import { MESSAGES } from '@/lib/i18n/messages'

// アクセシビリティの自動チェック（axe）。WCAG 2.1 の A / AA の違反がないことを、明暗の両方の配色で確かめる

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** What-if を変えたときの表示（ロス・タイマー・証明書の ✗ など）も確かめる */
const WHAT_IF_QUERIES = [
  'themes/tcp-handshake?opt.synLoss=twice&step=99',
  'themes/dns-resolution?opt.name=alias&step=99',
  'themes/tls-handshake?opt.certProblem=expired&step=99',
]

const paths = LOCALES.flatMap((locale) => [
  `${locale}/`,
  ...THEME_META.flatMap((meta) => [
    `${locale}/themes/${meta.id}`,
    `${locale}/themes/${meta.id}?step=99`,
  ]),
  ...WHAT_IF_QUERIES.map((query) => `${locale}/${query}`),
])

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  // 失敗したときに、どの要素が何の規則に違反したかがわかる形にする
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    for (const path of paths) {
      test(`axe: ${path}`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectNoViolations(page)
      })
    }

    for (const meta of THEME_META) {
      test(`axe: クイズに回答した後（${meta.id}）`, async ({ page }) => {
        await page.goto(`en/themes/${meta.id}`)
        const quiz = page.getByRole('region', { name: MESSAGES.en.quiz.title })
        const questions = quiz.getByRole('group')
        // 最後の選択肢を選び、正解と不正解の両方の表示が混ざるようにする
        for (const question of await questions.all()) {
          await question.getByRole('button').last().click()
        }
        await expect(quiz.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(
          await questions.count(),
        )
        await expectNoViolations(page)
      })
    }
  })
}
