import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  reducedMotion: 'always' | 'never' = 'always',
) {
  const onSelectMessage = vi.fn()
  // 座標を確認するため、既定ではアニメーションを止める
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reducedMotion}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </MotionConfig>
    </LazyMotion>
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

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    expect(screen.getByRole('button', { name: /rejected/ })).toHaveClass('text-destructive')
  })

  it('矢印の向きとロスの位置', () => {
    renderDiagram()
    const lines = (name: RegExp) => screen.getByRole('button', { name }).querySelector('line')
    const lost = lines(/lost$/)
    const rst = lines(/^RST/)
    // Client → Server の線は右向き、ロスは中点で止まる。Server → Client は左向き
    expect(Number(lost?.getAttribute('x2'))).toBeLessThan(
      Number(lines(/retransmission/)?.getAttribute('x2')),
    )
    expect(Number(rst?.getAttribute('x1'))).toBeGreaterThan(Number(rst?.getAttribute('x2')))
  })

  it('タイマーと経過時間を表示する', () => {
    renderDiagram()
    expect(
      screen.getByRole('img', { name: 'Client: RTO timer expired after 1s' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('t = 1s').length).toBeGreaterThan(0)
  })

  it('指定したステップまでのメッセージだけを描く（タイマーはボタンではない）', () => {
    renderDiagram({ stepIndex: 0 })
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('範囲外の stepIndex は丸め、現在のステップのメッセージを強調する', () => {
    renderDiagram({ stepIndex: 99 })
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /^RST/ })).toHaveAttribute('data-current', 'true')
    expect(screen.getByRole('button', { name: /lost$/ })).toHaveAttribute('data-current', 'false')
  })

  it('アニメーションが有効なら、現在のステップの線だけを送信側から伸ばす', () => {
    renderDiagram({}, 'en', 'never')
    const line = (name: RegExp) => screen.getByRole('button', { name }).querySelector('line')
    const rst = line(/^RST/)
    // 描画直後は開始状態（終点が始点と同じ）。アニメーションが進む前に同期的に確認する
    expect(rst?.getAttribute('x2')).toBe(rst?.getAttribute('x1'))
    const done = line(/retransmission/)
    expect(done?.getAttribute('x2')).not.toBe(done?.getAttribute('x1'))
  })

  it('狭い画面ではアクターの短縮名を使う', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    renderDiagram({
      actors: actors.map((actor) =>
        actor.id === 'client' ? { ...actor, shortName: { en: 'C', ja: 'C' } } : actor,
      ),
    })
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.queryByText('Client')).toBeNull()
    // 短縮名のないアクターは通常の名前
    expect(screen.getByText('Server')).toBeInTheDocument()
  })

  it('タイマーのないシナリオでは経過時間の列を出さない', () => {
    const first = steps[0]
    renderDiagram({ steps: first === undefined ? [] : [first], stepIndex: 0 })
    expect(screen.queryByText(/^t = /)).toBeNull()
  })

  it('タイマーのあるシナリオでは、まだタイマーの前でも経過時間の列を出す', () => {
    renderDiagram({ stepIndex: 0 })
    expect(screen.getByText('t = 0s')).toBeInTheDocument()
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

  it('選択中のメッセージをもう一度押すと選択を解除する', async () => {
    const user = userEvent.setup()
    const { onSelectMessage } = renderDiagram({ selectedMessageId: 'rst' })
    await user.click(screen.getByRole('button', { name: /^RST/ }))
    expect(onSelectMessage).toHaveBeenLastCalledWith(null)
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
