import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { waitForPage } from '@/test/waitForPage'

/** 現在の URL を表示し、外からの遷移（戻る・進むやリンク）を再現するボタンを置く */
function Probe({ to = '/en/themes/tcp-handshake?step=4' }: { to?: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{location.pathname + location.search}</output>
      <button
        type="button"
        data-testid="external-navigation"
        onClick={() => {
          void navigate(to)
        }}
      />
    </>
  )
}

// main.tsx と同じく StrictMode で描画し、effect の二重実行でも URL の同期が壊れないことを確かめる
async function renderAt(path: string, externalTarget?: string) {
  const result = render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Probe {...(externalTarget === undefined ? {} : { to: externalTarget })} />
      </MemoryRouter>
    </StrictMode>,
  )
  await waitForPage()
  return result
}

afterEach(() => {
  vi.useRealTimers()
})

const location = () => screen.getByTestId('location').textContent

describe('ThemePage', () => {
  it('テーマのタイトル・ステップ実行・クイズを表示する', async () => {
    await renderAt('/en/themes/tcp-handshake')
    expect(
      screen.getByRole('heading', { level: 1, name: 'TCP three-way handshake' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Sequence diagram' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Packet details' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Check your understanding' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('TCP three-way handshake | NetworkStudy')
    })
  })

  it('表示中のロケールの概要（MDX）を読み込んで表示する', async () => {
    await renderAt('/ja/themes/tcp-handshake')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'なぜハンドシェイクが必要か' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Why a handshake?' })).toBeNull()
    expect(screen.getByRole('link', { name: /RFC 9293/ })).toHaveAttribute(
      'href',
      'https://www.rfc-editor.org/rfc/rfc9293',
    )
  })

  it('URL の ?step= と opt.* から始める', async () => {
    await renderAt('/ja/themes/tcp-handshake?opt.serverPort=closed&step=3')
    expect(screen.getByText('ステップ 3 / 4')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'サーバーがリセットを返す' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '閉じている（誰も待ち受けていない）' })).toBeChecked()
  })

  it('範囲外の ?step= は丸めて URL に書き戻す', async () => {
    await renderAt('/en/themes/tcp-handshake?step=99')
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
  })

  it('ステップを進めると URL に書き戻し、オプションを変えると最初のステップに戻る', async () => {
    const user = userEvent.setup()
    await renderAt('/en/themes/tcp-handshake')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=3')
    })

    await user.click(screen.getByRole('switch', { name: 'Lose the server’s SYN, ACK' }))
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?opt.synAckLost=1')
    })
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  it('外から ?step= だけが変わったら、そのステップへ移る（URL を古い値で上書きしない）', async () => {
    await renderAt('/en/themes/tcp-handshake?step=2')
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('external-navigation'))
    await waitFor(() => {
      expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()
    })
    expect(location()).toBe('/en/themes/tcp-handshake?step=4')
  })

  it('最後のステップで範囲外の ?step= が外から来ても、表示はそのままで URL を正規化する', async () => {
    await renderAt('/en/themes/tcp-handshake?step=5', '/en/themes/tcp-handshake?step=99')
    fireEvent.click(screen.getByTestId('external-navigation'))
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
  })

  it('自動再生中はステップが進むたびに URL に書き戻し、最後で止まる', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderAt('/en/themes/tcp-handshake?step=4')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('キーボードの → でステップを進める', async () => {
    await renderAt('/en/themes/tcp-handshake')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    })
  })

  it('図のメッセージを選ぶと、パケットの詳細に表示する', async () => {
    const user = userEvent.setup()
    await renderAt('/en/themes/tcp-handshake?step=4')
    await user.click(screen.getByRole('button', { name: /^SYN, from Client to Server/ }))
    const inspector = screen.getByRole('region', { name: 'Packet details' })
    expect(within(inspector).getByRole('heading', { level: 3, name: 'SYN' })).toBeInTheDocument()
    expect(within(inspector).getByText('1000')).toBeInTheDocument()
  })

  it('DNS の NXDOMAIN の分岐: 否定応答をパケットの詳細とキャッシュ表で見せる', async () => {
    await renderAt('/ja/themes/dns-resolution?opt.name=missing&step=7')
    expect(
      screen.getByRole('heading', { level: 2, name: '名前が存在しない（NXDOMAIN）' }),
    ).toBeInTheDocument()
    const inspector = screen.getByRole('region', { name: 'パケットの詳細' })
    expect(within(inspector).getAllByText('NXDOMAIN').length).toBeGreaterThan(0)
    expect(within(inspector).getByText(/example\.com\. SOA/)).toBeInTheDocument()
    const state = screen.getByRole('region', { name: '各参加者の状態' })
    expect(within(state).getByText('(negative)')).toBeInTheDocument()
  })

  it('TLS: 証明書チェーンは専用のパネルで見せ、汎用の状態パネルには出さない', async () => {
    await renderAt('/en/themes/tls-handshake?opt.certProblem=expired&step=99')
    const panel = screen.getByRole('region', { name: 'Certificate chain' })
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'Server certificatewww.example.com',
      'Intermediate CAExample Intermediate CA',
      'Root CAExample Root CA',
    ])
    expect(within(panel).getByText('2026-08-31')).toBeInTheDocument()
    const state = screen.getByRole('region', { name: 'State of each participant' })
    expect(within(state).queryByText('Certificate chain check')).toBeNull()
    expect(within(state).getByText('certificate_expired')).toBeInTheDocument()
  })

  it('未知のテーマは NotFound', async () => {
    await renderAt('/en/themes/no-such-theme')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('テーマへの導線', () => {
  it('サイドバーとホームのカードからテーマへ行ける。現在のテーマは aria-current', async () => {
    await renderAt('/en/themes/tcp-handshake')
    const sidebar = screen.getByRole('navigation', { name: 'Themes' })
    expect(within(sidebar).getByRole('link', { name: 'TCP three-way handshake' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('ホームにテーマのカードを表示する', async () => {
    await renderAt('/ja')
    const list = screen.getByRole('region', { name: 'どこから始めるか' })
    expect(within(list).getByRole('link', { name: 'TCP 3 ウェイハンドシェイク' })).toHaveAttribute(
      'href',
      '/ja/themes/tcp-handshake',
    )
    expect(within(list).getAllByText('初級').length).toBeGreaterThan(0)
    // サイトで案内する学習順（DNS → TCP）に並ぶ
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['DNS の名前解決', 'TCP 3 ウェイハンドシェイク', 'TLS 1.3 のハンドシェイクと証明書'])
    expect(screen.getByRole('region', { name: 'このサイトの使い方' })).toBeInTheDocument()
  })

  it('ホームのカードにクイズの進捗を表示する', async () => {
    window.localStorage.setItem(
      'ns.quiz.tcp-handshake',
      JSON.stringify({ answers: { 'first-segment': 'syn', 'state-after-syn': 'listen' } }),
    )
    await renderAt('/en')
    const cards = within(screen.getByRole('region', { name: 'Where to start' })).getAllByRole(
      'listitem',
    )
    expect(cards.map((card) => within(card).getByText(/^Quiz/).textContent)).toEqual([
      'Quiz not taken yet',
      'Quiz: 1 of 5 correct',
      'Quiz not taken yet',
    ])
    // 学習順の番号
    expect(cards.map((card) => card.querySelector('[aria-hidden]')?.textContent)).toEqual([
      '1',
      '2',
      '3',
    ])
  })
})
