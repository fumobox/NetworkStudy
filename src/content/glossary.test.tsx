import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { collectQuizTexts } from '@/components/features/quiz/validate'
import { collectLocalizedTexts } from '@/engine/validate'
import { ja } from '@/lib/i18n/messages/ja'
import { THEMES } from './registry'
import { binarySplitText, SUBNET_TEXT } from './subnet-calculator/subnetText'
import { CERT_CHAIN_TEXT } from './tls-handshake/certChainText'
import { THEME_META } from './themeMeta'

// docs/glossary.md の表記の規則のうち、機械的に確かめられるものを日本語の文章すべてについて検査する

/** 使わない表記（docs/glossary.md の「表記の規則」と「訳語の対応表」） */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly use: string }[] = [
  { pattern: /サーバ(?!ー)/, use: 'サーバー' },
  { pattern: /リゾルバ(?!ー)/, use: 'リゾルバー' },
  { pattern: /ブラウザ(?!ー)/, use: 'ブラウザー' },
  { pattern: /タイマ(?!ー)/, use: 'タイマー' },
  { pattern: /ヘッダ(?!ー)/, use: 'ヘッダー' },
  { pattern: /ルータ(?!ー)/, use: 'ルーター' },
  { pattern: /ユーザ(?!ー)/, use: 'ユーザー' },
  { pattern: /コンピュータ(?!ー)/, use: 'コンピューター' },
  { pattern: /ハンドシェーク/, use: 'ハンドシェイク' },
  { pattern: /アクノリッジ/, use: '確認応答' },
  { pattern: /[Ａ-Ｚａ-ｚ０-９]/, use: '半角英数字' },
]

// かな（長音の「ー」を含み、「・」は含めない）・漢字と半角英数字が、スペースなしで隣り合っている
const JAPANESE = '[\\u3041-\\u3096\\u30A1-\\u30FA\\u30FC\\u4E00-\\u9FFF]'
const MISSING_SPACE = new RegExp(`${JAPANESE}[A-Za-z0-9]|[A-Za-z0-9]${JAPANESE}`)

interface JapaneseText {
  readonly path: string
  readonly text: string
}

function findGlossaryProblems(texts: readonly JapaneseText[]): string[] {
  return texts.flatMap(({ path, text }) => {
    const variants = FORBIDDEN.flatMap(({ pattern, use }) => {
      const found = pattern.exec(text)
      return found === null ? [] : [`${path}: ${found[0]} → ${use}`]
    })
    const missingSpace = MISSING_SPACE.exec(text)
    return missingSpace === null
      ? variants
      : [...variants, `${path}: 日本語と英数字の間にスペースがない（${missingSpace[0]}）`]
  })
}

/**
 * 関数の文言に渡す引数。どのプロパティを読んでも、英字の目印を返す（数値の引数も String() で文字列になる）。
 * 埋め込みの前後の固定の文字列と、埋め込みとの間のスペースを検査するため
 */
const PLACEHOLDER_ARGS = new Proxy({}, { get: () => 'X' })

/** 辞書の文字列を集める。関数は目印の引数で呼び出した結果を検査する */
function collectMessageTexts(value: unknown, path: string): JapaneseText[] {
  if (typeof value === 'string') {
    return [{ path, text: value }]
  }
  if (typeof value === 'function') {
    const result: unknown = Reflect.apply(value, undefined, [PLACEHOLDER_ARGS])
    return collectMessageTexts(result, `${path}()`)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectMessageTexts(item, `${path}[${String(i)}]`))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectMessageTexts(item, `${path}.${key}`),
    )
  }
  return []
}

/** テーマ固有のパネルの文言（入れ子の LocalizedText）から、日本語を集める */
function collectJapanese(value: unknown, path: string): JapaneseText[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }
  if ('ja' in value && typeof value.ja === 'string') {
    return [{ path, text: value.ja }]
  }
  return Object.entries(value).flatMap(([key, item]) => collectJapanese(item, `${path}.${key}`))
}

describe('用語集（docs/glossary.md）の表記', () => {
  it('検査の規則そのもの', () => {
    expect(
      findGlossaryProblems([
        {
          path: 'ok',
          text: 'サーバーが TCP の 3 ウェイハンドシェイクで SYN, ACK を返す・NXDOMAIN（否定応答）',
        },
        { path: 'variant', text: 'サーバがリゾルバに問い合わせる' },
        { path: 'space', text: 'TCPの接続' },
        { path: 'fullwidth', text: 'ＳＹＮ を送る' },
        { path: 'long-vowel', text: 'サーバーA' },
      ]),
    ).toEqual([
      'variant: サーバ → サーバー',
      'variant: リゾルバ → リゾルバー',
      'space: 日本語と英数字の間にスペースがない（Pの）',
      'fullwidth: Ｓ → 半角英数字',
      'long-vowel: 日本語と英数字の間にスペースがない（ーA）',
    ])
  })

  it('シナリオ・クイズ・メタ情報・テーマ固有のパネル', () => {
    const texts = [
      ...THEME_META.flatMap((meta) => [
        { path: `${meta.id}.title`, text: meta.title.ja },
        { path: `${meta.id}.summary`, text: meta.summary.ja },
      ]),
      ...collectJapanese(CERT_CHAIN_TEXT, 'tls-handshake.CertChainPanel'),
      ...collectJapanese(SUBNET_TEXT, 'subnet-calculator.SubnetCalculator'),
      ...collectJapanese(binarySplitText(26), 'subnet-calculator.binarySplitText'),
      ...THEMES.flatMap((theme) =>
        [
          ...(theme.kind === 'sequence' ? collectLocalizedTexts(theme.scenario) : []),
          ...collectQuizTexts(theme.quiz),
        ].map((entry) => ({ path: `${theme.meta.id}.${entry.path}`, text: entry.text.ja })),
      ),
    ]
    expect(texts.length).toBeGreaterThan(100)
    expect(findGlossaryProblems(texts)).toEqual([])
  })

  it('UI の辞書', () => {
    const texts = collectMessageTexts(ja, 'ja')
    expect(texts.length).toBeGreaterThan(50)
    // 関数の文言も対象になっている
    expect(texts.find((entry) => entry.path === 'ja.stepper.counter()')?.text).toBe(
      'ステップ X / X',
    )
    expect(findGlossaryProblems(texts)).toEqual([])
  })

  it.each(THEMES.map((theme) => [theme.meta.id, theme] as const))(
    '%s の概要（MDX）',
    async (id, theme) => {
      const Overview = theme.overview.ja
      const { container } = render(
        <Suspense fallback={null}>
          <Overview />
        </Suspense>,
      )
      await screen.findAllByRole('heading', { level: 2 })
      // 段落・見出し・リストの項目ごとに検査する（要素の境目で文字がつながらないように）
      const texts = [...container.querySelectorAll('h2, h3, p, li, td, th')].map((element, i) => ({
        path: `${id}.overview[${String(i)}]`,
        text: element.textContent,
      }))
      expect(texts.length).toBeGreaterThan(5)
      expect(findGlossaryProblems(texts)).toEqual([])
    },
  )
})
