import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { deriveState } from '../derive'
import type { Actor, Step } from '../types'
import { PacketInspector } from './PacketInspector'

const actors: readonly Actor[] = [
  { id: 'client', kind: 'client', name: { en: 'Client', ja: 'クライアント' }, stateSlots: [] },
  { id: 'server', kind: 'server', name: { en: 'Server', ja: 'サーバー' }, stateSlots: [] },
]
const text = (en: string, ja = en) => ({ en, ja })

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
          description: text('Request to open a connection', '接続の開始を要求する'),
          fields: [
            {
              name: 'Flags',
              value: 'SYN',
              highlight: true,
              description: text('Synchronize', '同期'),
            },
            { name: 'Seq', value: '1000' },
          ],
        },
      },
    ],
  },
  {
    id: 'rtx',
    title: text('RTX'),
    description: text('RTX'),
    events: [
      {
        kind: 'message',
        message: {
          id: 'syn-rtx',
          from: 'client',
          to: 'server',
          label: 'SYN',
          status: 'delivered',
          retransmitOf: 'syn',
          encrypted: true,
          fields: [],
        },
      },
    ],
  },
]

/** dt（role="term"）は中身から名前が計算されないので、テキストで探す */
function terms(pattern: RegExp): HTMLElement[] {
  return screen.getAllByRole('term').filter((term) => pattern.test(term.textContent))
}

function renderInspector(
  stepIndex: number,
  selectedMessageId: string | null,
  locale: Locale = 'en',
) {
  render(
    <LocaleProvider locale={locale}>
      <PacketInspector
        actors={actors}
        derived={deriveState(actors, steps, stepIndex)}
        selectedMessageId={selectedMessageId}
      />
    </LocaleProvider>,
  )
}

describe('PacketInspector', () => {
  it('未選択なら現在のステップの最新メッセージを表示する', () => {
    renderInspector(1, null)
    expect(screen.getByRole('heading', { level: 3, name: 'SYN' })).toBeInTheDocument()
    expect(screen.getByText('Retransmission of SYN')).toBeInTheDocument()
  })

  it('選択したメッセージの送信元・送信先・状態・説明・フィールドを表示する', () => {
    renderInspector(1, 'syn')
    const section = screen.getByRole('region', { name: 'Packet details' })
    expect(within(section).getByText('Client → Server')).toBeInTheDocument()
    expect(within(section).getByText('lost')).toBeInTheDocument()
    expect(within(section).getByText('Request to open a connection')).toBeInTheDocument()
    expect(
      within(section)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual([expect.stringContaining('Flags'), 'Seq'])
    expect(within(section).getByText('1000')).toBeInTheDocument()
  })

  it('注目するフィールドは記号と読み上げ用のテキストでも示す', () => {
    renderInspector(0, null)
    const flags = terms(/Flags/)[0]
    expect(flags).toHaveTextContent('Key field in this step')
    expect(flags?.closest('[data-highlight]')).toHaveAttribute('data-highlight', 'true')
    expect(terms(/^Seq$/)[0]?.closest('[data-highlight]')).toHaveAttribute(
      'data-highlight',
      'false',
    )
  })

  it('同じ名前のフィールドがあっても key が衝突しない', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dup: Step[] = [
      {
        id: 'a',
        title: text('a'),
        description: text('a'),
        events: [
          {
            kind: 'message',
            message: {
              id: 'ans',
              from: 'server',
              to: 'client',
              label: 'Response',
              status: 'delivered',
              fields: [
                { name: 'Answer', value: '192.0.2.1' },
                { name: 'Answer', value: '192.0.2.2' },
              ],
            },
          },
        ],
      },
    ]
    render(
      <LocaleProvider locale="en">
        <PacketInspector
          actors={actors}
          derived={deriveState(actors, dup, 0)}
          selectedMessageId={null}
        />
      </LocaleProvider>,
    )
    expect(terms(/^Answer$/)).toHaveLength(2)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('暗号化されたメッセージには学習用に中身を見せている旨の注記を出す', () => {
    renderInspector(1, null)
    expect(screen.getByText(/In reality this message is encrypted/)).toBeInTheDocument()
  })

  it('日本語で表示する', () => {
    renderInspector(0, null, 'ja')
    expect(screen.getByRole('region', { name: 'パケットの詳細' })).toBeInTheDocument()
    expect(screen.getByText('クライアント → サーバー')).toBeInTheDocument()
    expect(screen.getByText('ロス')).toBeInTheDocument()
    expect(screen.getByText('同期')).toBeInTheDocument()
  })

  it('メッセージがなければその旨を表示する', () => {
    render(
      <LocaleProvider locale="en">
        <PacketInspector
          actors={actors}
          derived={deriveState(actors, [], 0)}
          selectedMessageId={null}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText('No message to show yet.')).toBeInTheDocument()
  })
})
