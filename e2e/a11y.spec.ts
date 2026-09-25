import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { THEME_META } from '@/content/themeMeta'
import { LOCALES } from '@/lib/i18n/locale'
import { MESSAGES } from '@/lib/i18n/messages'

// アクセシビリティの自動チェック（axe）。WCAG 2.1 の A / AA の違反がないことを、明暗の両方の配色で確かめる

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** What-if を変えたときの表示（ロス・タイマー・証明書の ✗ など）も確かめる（テーマの id → クエリ） */
const WHAT_IF_QUERIES: Readonly<Record<string, string>> = {
  'tcp-handshake': '?opt.synLoss=twice&step=99',
  'dns-resolution': '?opt.name=alias&step=99',
  'tls-handshake': '?opt.certProblem=expired&step=99',
}

interface PageCase {
  readonly path: string
  /** 表示されるまで待つ h1（遅延読み込みのページが描画されたことを確かめる） */
  readonly heading: string
}

const pages: readonly PageCase[] = LOCALES.flatMap((locale) => [
  { path: `${locale}/`, heading: MESSAGES[locale].common.siteName },
  ...THEME_META.flatMap((meta) => {
    const heading = meta.title[locale]
    const base = `${locale}/themes/${meta.id}`
    const whatIf = WHAT_IF_QUERIES[meta.id]
    return [
      { path: base, heading },
      { path: `${base}?step=99`, heading },
      ...(whatIf === undefined ? [] : [{ path: `${base}${whatIf}`, heading }]),
    ]
  }),
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

/**
 * すべての設問に回答し、正解と不正解の両方の表示が画面に出る状態にする（両方の見た目を axe で確かめるため）。
 * e2e からはクイズの正解を読めないので、まず最初の選択肢で答え、どちらかに偏ったら最初の設問だけ答え直す
 */
async function answerWithBothResults(questions: Locator, total: number) {
  const m = MESSAGES.en.quiz
  const answerAll = async (firstChoice: (choices: Locator) => Locator) => {
    for (const [index, question] of (await questions.all()).entries()) {
      const choices = question.getByRole('button')
      await (index === 0 ? firstChoice(choices) : choices.first()).click()
    }
    await expect(questions.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(total)
  }
  const statusOf = (index: number) => questions.nth(index).getByRole('status')

  await answerAll((choices) => choices.first())
  const correctCount = await questions.getByRole('status').getByText(m.correct).count()
  if (correctCount === 0 || correctCount === total) {
    // 不正解の表示にある正解の文言（なければ最初の選択肢が正解なので、最後の選択肢）で最初の設問を答え直す
    const prefix = m.answerIs({ answer: '' })
    const hint = statusOf(0).getByText(prefix)
    const answerText =
      (await hint.count()) === 0 ? undefined : (await hint.textContent())?.replace(prefix, '')
    await questions.page().getByRole('button', { name: m.reset }).click()
    await answerAll((choices) =>
      answerText === undefined ? choices.last() : choices.getByText(answerText, { exact: true }),
    )
  }
  await expect(questions.getByRole('status').getByText(m.correct).first()).toBeVisible()
  await expect(questions.getByRole('status').getByText(m.incorrect).first()).toBeVisible()
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    for (const { path, heading } of pages) {
      test(`axe: ${path}`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
        await expectNoViolations(page)
      })
    }

    for (const meta of THEME_META) {
      test(`axe: クイズに回答した後（${meta.id}）`, async ({ page }) => {
        await page.goto(`en/themes/${meta.id}`)
        const quiz = page.getByRole('region', { name: MESSAGES.en.quiz.title })
        const questions = quiz.getByRole('group')
        // テーマのページは遅延読み込みなので、設問が表示されるまで待ってから数える（all() と count() は待たない）
        await expect(questions.first()).toBeVisible()
        const total = await questions.count()
        expect(total).toBeGreaterThan(1)
        await answerWithBothResults(questions, total)
        await expectNoViolations(page)
      })
    }
  })
}
