import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'

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
function renderAt(path: string, externalTarget?: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Probe {...(externalTarget === undefined ? {} : { to: externalTarget })} />
      </MemoryRouter>
    </StrictMode>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

const location = () => screen.getByTestId('location').textContent

describe('ThemePage', () => {
  it('テーマのタイトル・ステップ実行・クイズを表示する', async () => {
    renderAt('/en/themes/tcp-handshake')
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

  it('URL の ?step= と opt.* から始める', () => {
    renderAt('/ja/themes/tcp-handshake?opt.serverPort=closed&step=3')
    expect(screen.getByText('ステップ 3 / 4')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'サーバーがリセットを返す' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '閉じている（誰も待ち受けていない）' })).toBeChecked()
  })

  it('範囲外の ?step= は丸めて URL に書き戻す', async () => {
    renderAt('/en/themes/tcp-handshake?step=99')
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
  })

  it('ステップを進めると URL に書き戻し、オプションを変えると最初のステップに戻る', async () => {
    const user = userEvent.setup()
    renderAt('/en/themes/tcp-handshake')
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
    renderAt('/en/themes/tcp-handshake?step=2')
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('external-navigation'))
    await waitFor(() => {
      expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()
    })
    expect(location()).toBe('/en/themes/tcp-handshake?step=4')
  })

  it('最後のステップで範囲外の ?step= が外から来ても、表示はそのままで URL を正規化する', async () => {
    renderAt('/en/themes/tcp-handshake?step=5', '/en/themes/tcp-handshake?step=99')
    fireEvent.click(screen.getByTestId('external-navigation'))
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
  })

  it('自動再生中はステップが進むたびに URL に書き戻し、最後で止まる', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt('/en/themes/tcp-handshake?step=4')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => {
      expect(location()).toBe('/en/themes/tcp-handshake?step=5')
    })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('キーボードの → でステップを進める', async () => {
    renderAt('/en/themes/tcp-handshake')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    })
  })

  it('図のメッセージを選ぶと、パケットの詳細に表示する', async () => {
    const user = userEvent.setup()
    renderAt('/en/themes/tcp-handshake?step=4')
    await user.click(screen.getByRole('button', { name: /^SYN, from Client to Server/ }))
    const inspector = screen.getByRole('region', { name: 'Packet details' })
    expect(within(inspector).getByRole('heading', { level: 3, name: 'SYN' })).toBeInTheDocument()
    expect(within(inspector).getByText('1000')).toBeInTheDocument()
  })

  it('未知のテーマは NotFound', () => {
    renderAt('/en/themes/no-such-theme')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('テーマへの導線', () => {
  it('サイドバーとホームのカードからテーマへ行ける。現在のテーマは aria-current', () => {
    renderAt('/en/themes/tcp-handshake')
    const sidebar = screen.getByRole('navigation', { name: 'Themes' })
    expect(within(sidebar).getByRole('link', { name: 'TCP three-way handshake' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('ホームにテーマのカードを表示する', () => {
    renderAt('/ja')
    const list = screen.getByRole('region', { name: 'テーマ一覧' })
    expect(within(list).getByRole('link', { name: 'TCP 3 ウェイハンドシェイク' })).toHaveAttribute(
      'href',
      '/ja/themes/tcp-handshake',
    )
    expect(within(list).getByText('初級')).toBeInTheDocument()
  })
})
