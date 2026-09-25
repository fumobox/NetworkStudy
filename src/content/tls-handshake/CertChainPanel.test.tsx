import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { CertChainPanel } from './CertChainPanel'
import { tlsHandshakeScenario, type CertProblem } from './scenario'

function renderPanel(certProblem: CertProblem, stepId: string, locale: Locale = 'en') {
  const steps = tlsHandshakeScenario.buildSteps({ certProblem })
  const index = stepId === 'last' ? steps.length - 1 : steps.findIndex((step) => step.id === stepId)
  const derived = deriveState(tlsHandshakeScenario.actors, steps, index)
  render(
    <LocaleProvider locale={locale}>
      <CertChainPanel derived={derived} options={{ certProblem }} />
    </LocaleProvider>,
  )
  return screen.getByRole('region', {
    name: locale === 'en' ? 'Certificate chain' : '証明書チェーン',
  })
}

/** 各証明書のカードの検証項目を [ラベル, 結果] で取り出す */
function checksOf(panel: HTMLElement, subject: string): string[][] {
  const card = within(panel)
    .getAllByRole('heading', { level: 3 })
    .find((heading) => heading.querySelector('.font-mono')?.textContent === subject)
    ?.closest('article')
  if (card === null || card === undefined) throw new Error(`no card for ${subject}`)
  return [...card.querySelectorAll('li[data-result]')].map((item) => {
    const spans = item.querySelectorAll('span')
    return [spans[0]?.textContent ?? '', spans[1]?.textContent ?? '']
  })
}

describe('CertChainPanel', () => {
  it('証明書を受け取る前はその旨を表示する', () => {
    const panel = renderPanel('none', 'client-hello')
    expect(
      within(panel).getByText('The server has not sent its certificates yet.'),
    ).toBeInTheDocument()
  })

  it('受け取った直後は、どの項目も未確認', () => {
    const panel = renderPanel('none', 'certificate')
    expect(checksOf(panel, 'www.example.com').map(([, result]) => result)).toEqual([
      'Not checked yet',
      'Not checked yet',
      'Not checked yet',
    ])
  })

  it('検証が通れば、各証明書の意味のある項目がすべて合格', () => {
    const panel = renderPanel('none', 'last')
    expect(checksOf(panel, 'www.example.com')).toEqual([
      ['Signature by the issuer', 'OK'],
      ['Within the validity period', 'OK'],
      ['Issued for www.example.com', 'OK'],
    ])
    expect(checksOf(panel, 'Example Intermediate CA')).toEqual([
      ['Signature by the issuer', 'OK'],
      ['Within the validity period', 'OK'],
    ])
    expect(checksOf(panel, 'Example Root CA')).toEqual([
      ['Within the validity period', 'OK'],
      ['In the client’s trust store', 'OK'],
    ])
  })

  it('期限切れは有効期間だけが不合格', () => {
    expect(checksOf(renderPanel('expired', 'last'), 'www.example.com')[1]).toEqual([
      'Within the validity period',
      'Failed',
    ])
  })

  it('名前の不一致は名前だけが不合格', () => {
    expect(checksOf(renderPanel('nameMismatch', 'last'), 'www.example.com')[2]).toEqual([
      'Issued for www.example.com',
      'Failed',
    ])
  })

  it('未知の CA はルートの信頼だけが不合格', () => {
    expect(checksOf(renderPanel('unknownCa', 'last'), 'Unknown Root CA')[1]).toEqual([
      'In the client’s trust store',
      'Failed',
    ])
  })

  it('中間証明書の欠落: 送られなかった証明書を示し、サーバー証明書の署名は確かめられない', () => {
    const panel = renderPanel('missingIntermediate', 'last')
    expect(within(panel).getByText('Not sent by the server')).toBeInTheDocument()
    expect(checksOf(panel, 'www.example.com')[0]).toEqual([
      'Signature by the issuer',
      'Cannot check',
    ])
  })

  it('見出しに役割と証明書の名前を含める', () => {
    const panel = renderPanel('none', 'last')
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'Server certificatewww.example.com',
      'Intermediate CAExample Intermediate CA',
      'Root CAExample Root CA',
    ])
  })

  it('日本語で表示する', () => {
    const panel = renderPanel('expired', 'last', 'ja')
    expect(within(panel).getByText('サーバー証明書')).toBeInTheDocument()
    expect(checksOf(panel, 'www.example.com')[1]).toEqual(['有効期間内', '不合格'])
  })
})
