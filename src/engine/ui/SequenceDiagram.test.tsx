import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import type { Actor, Step } from '../types'
import { SequenceDiagram } from './SequenceDiagram'

const actors: readonly Actor[] = [
  { id: 'client', kind: 'client', name: { en: 'Client', ja: 'クライアント' }, stateSlots: [] },
  { id: 'server', kind: 'server', name: { en: 'Server', ja: 'サーバー' }, stateSlots: [] },
]

const text = (en: string) => ({ en, ja: en })

const steps: readonly Step[] = [
  {
    id: 'syn',
    title: text('SYN'),
    description: text('SYN'),
    events: [
      {
        kind: 'message',
        message: {
          id: 'syn',
          from: 'client',
          to: 'server',
          label: 'SYN',
          status: 'lost',
          fields: [],
        },
      },
    ],
  },
  {
    id: 'rto',
    title: text('RTO'),
    description: text('RTO'),
    events: [
      { kind: 'timer', actorId: 'client', name: 'RTO', durationMs: 1000 },
      {
        kind: 'message',
        message: {
          id: 'syn-rtx',
          from: 'client',
          to: 'server',
          label: 'SYN',
          status: 'delivered',
          fields: [],
          retransmitOf: 'syn',
        },
      },
    ],
  },
  {
    id: 'rst',
    title: text('RST'),
    description: text('RST'),
    events: [
      {
        kind: 'message',
        message: {
          id: 'rst',
          from: 'server',
          to: 'client',
          label: 'RST',
          status: 'rejected',
          fields: [],
          encrypted: true,
        },
      },
    ],
  },
]

function renderDiagram(
  props: Partial<Parameters<typeof SequenceDiagram>[0]> = {},
  locale: Locale = 'en',
) {
  const onSelectMessage = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider locale={locale}>{children}</LocaleProvider>
  )
  render(
    <SequenceDiagram
      actors={actors}
      steps={steps}
      stepIndex={2}
      selectedMessageId={null}
      onSelectMessage={onSelectMessage}
      {...props}
    />,
    { wrapper },
  )
  return { onSelectMessage }
}

describe('SequenceDiagram', () => {
  it('アクター名と、各メッセージをボタンとして描く（状態・再送・暗号化を名前で伝える）', () => {
    renderDiagram()
    expect(screen.getByRole('group', { name: 'Sequence diagram' })).toBeInTheDocument()
    expect(screen.getByText('Client')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'SYN, from Client to Server, lost' }),
    ).toHaveAttribute('data-status', 'lost')
    expect(
      screen.getByRole('button', { name: 'SYN, from Client to Server, delivered, retransmission' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'RST, from Server to Client, rejected, encrypted' }),
    ).toBeInTheDocument()
  })

  it('ロスは × 、拒否は ✗ 、再送は ↻ の記号でも示す（色だけに頼らない）', () => {
    renderDiagram()
    expect(screen.getByText('×')).toBeInTheDocument()
    expect(screen.getByText('✗')).toBeInTheDocument()
    expect(screen.getByText('SYN ↻')).toBeInTheDocument()
  })

  it('タイマーと経過時間を表示する', () => {
    renderDiagram()
    expect(
      screen.getByRole('img', { name: 'Client: RTO timer expired after 1s' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('t = 1s').length).toBeGreaterThan(0)
  })

  it('指定したステップまでのメッセージだけを描く', () => {
    renderDiagram({ stepIndex: 0 })
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('クリックと Enter / Space でメッセージを選択する', async () => {
    const user = userEvent.setup()
    const { onSelectMessage } = renderDiagram()
    await user.click(screen.getByRole('button', { name: /^RST/ }))
    expect(onSelectMessage).toHaveBeenLastCalledWith('rst')

    screen.getByRole('button', { name: /lost$/ }).focus()
    await user.keyboard('{Enter}')
    expect(onSelectMessage).toHaveBeenLastCalledWith('syn')
    await user.keyboard(' ')
    expect(onSelectMessage).toHaveBeenCalledTimes(3)
  })

  it('選択中のメッセージに aria-pressed を付ける', () => {
    renderDiagram({ selectedMessageId: 'rst' })
    expect(screen.getByRole('button', { name: /^RST/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /lost$/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('日本語で表示する', () => {
    renderDiagram({}, 'ja')
    expect(screen.getByRole('group', { name: 'シーケンス図' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'RST、サーバー から クライアント へ、拒否、暗号化' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('t = 1 秒').length).toBeGreaterThan(0)
  })

  it('メッセージがまだなければその旨を表示する', () => {
    renderDiagram({
      steps: [{ id: 'x', title: text('x'), description: text('x'), events: [] }],
      stepIndex: 0,
    })
    expect(screen.getByText('No messages have been sent yet.')).toBeInTheDocument()
  })
})
