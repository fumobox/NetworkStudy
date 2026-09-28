// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { isGroupAddress, isLocallyAdministered } from './frame'
import {
  CTS_DURATION_US,
  DATA_DURATION_US,
  IBSS_BSSID,
  MAC,
  PASSPHRASE,
  PMK,
  RTS_DURATION_US,
  SSID,
  WRONG_PASSPHRASE,
  WRONG_PMK,
  wifiScenario,
  type WifiOptions,
} from './scenario'

const handle = toScenarioHandle(wifiScenario)
const SITUATIONS = [
  'normal',
  'wrongPassphrase',
  'lostAck',
  'hiddenNode',
  'rtsCts',
  'adhoc',
] as const

const build = (situation: WifiOptions['situation'] = 'normal') =>
  wifiScenario.buildSteps({ situation })

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

const flow = (steps: readonly Step[]) =>
  messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)

const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function final(steps: readonly Step[]) {
  const state = deriveState(wifiScenario.actors, steps, steps.length - 1)
  return {
    staA: state.actorStates.staA?.values,
    ap: state.actorStates.ap?.values,
    staB: state.actorStates.staB?.values,
  }
}

const hexOf = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

/** PBKDF2(HMAC-SHA1, パスフレーズ, SSID, 4096, 256 ビット)（IEEE Std 802.11-2024 Annex J.4、RFC 8018 §5.2） */
async function psk(passphrase: string, ssid: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-1', salt: encoder.encode(ssid), iterations: 4096 },
    key,
    256,
  )
  return hexOf(bits)
}

const DISCOVERY = [
  'ap→staA Beacon (SSID example-wifi) delivered',
  'ap→staB Beacon (SSID example-wifi) delivered',
  'staA→ap Probe Request (wildcard SSID) delivered',
  'staA→staB Probe Request (wildcard SSID) rejected',
  'ap→staA Probe Response (example-wifi) delivered',
  'staA→ap Authentication (Open System, 1) delivered',
  'ap→staA Authentication (Open System, 2) delivered',
  'staA→ap Association Request (example-wifi) delivered',
  'ap→staA Association Response (AID 2) delivered',
]
const HIDDEN_DISCOVERY = DISCOVERY.filter((line) => !line.startsWith('staA→staB'))
const HANDSHAKE = [
  'ap→staA EAPOL-Key 1/4 (ANonce) delivered',
  'staA→ap EAPOL-Key 2/4 (SNonce, MIC) delivered',
  'ap→staA EAPOL-Key 3/4 (Install, GTK) delivered',
  'staA→ap EAPOL-Key 4/4 (MIC) delivered',
]

describe('wifiScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'rtsCts' }).options).toEqual({ situation: 'rtsCts' })
    expect(handle.resolve({ situation: 'mesh' }).options).toEqual({ situation: 'normal' })
  })

  it('ラベルは 40 文字以内で、タイマーは使わない', () => {
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      expect(Math.max(...messages(steps).map((m) => m.label.length))).toBeLessThanOrEqual(40)
      expect(steps.flatMap((step) => step.events).some((e) => e.kind === 'timer')).toBe(false)
    }
  })

  describe('流れ', () => {
    it('正常: スキャン、認証、アソシエーション、4 ウェイハンドシェイク、AP を経由したデータ', () => {
      expect(flow(build())).toEqual([
        ...DISCOVERY,
        ...HANDSHAKE,
        'staA→ap Data (ToDS=1) to STA B delivered',
        'ap→staA Ack delivered',
        'ap→staB Data (FromDS=1) from STA A delivered',
        'staB→ap Ack delivered',
      ])
    })

    it('パスフレーズの誤り: メッセージ 2 を 2 回捨て、理由 15 で切る', () => {
      expect(flow(build('wrongPassphrase'))).toEqual([
        ...DISCOVERY,
        'ap→staA EAPOL-Key 1/4 (ANonce) delivered',
        'staA→ap EAPOL-Key 2/4 (SNonce, MIC) rejected',
        'ap→staA EAPOL-Key 1/4 (ANonce) delivered',
        'staA→ap EAPOL-Key 2/4 (SNonce, MIC) rejected',
        'ap→staA Deauthentication (reason 15) delivered',
      ])
    })

    it('Ack の消失: 同じフレームを Retry=1 で再送し、AP は重複を捨てても Ack を返す', () => {
      expect(flow(build('lostAck'))).toEqual([
        ...DISCOVERY,
        ...HANDSHAKE,
        'staA→ap Data (ToDS=1) to STA B delivered',
        'ap→staA Ack lost',
        'staA→ap Data (Retry=1) to STA B delivered',
        'ap→staA Ack delivered',
        'ap→staB Data (FromDS=1) from STA A delivered',
        'staB→ap Ack delivered',
      ])
    })

    it('隠れ端末: 互いの電波が届かず、AP で衝突する', () => {
      expect(flow(build('hiddenNode'))).toEqual([
        ...HIDDEN_DISCOVERY,
        ...HANDSHAKE,
        'staB→ap Data (ToDS=1) to router lost',
        'staA→ap Data (ToDS=1) to router lost',
        'staA→ap Data (Retry=1) to router delivered',
        'ap→staA Ack delivered',
        'staB→ap Data (Retry=1) to router delivered',
        'ap→staB Ack delivered',
      ])
    })

    it('RTS/CTS: CTS は両方の STA に届き、宛先でない STA は NAV を設定する', () => {
      expect(flow(build('rtsCts'))).toEqual([
        ...HIDDEN_DISCOVERY,
        ...HANDSHAKE,
        'staB→ap RTS (Duration 176 µs) delivered',
        'ap→staB CTS (Duration 132 µs) delivered',
        'ap→staA CTS (Duration 132 µs) delivered',
        'staB→ap Data (ToDS=1) to router delivered',
        'ap→staB Ack delivered',
        'staA→ap RTS (Duration 176 µs) delivered',
        'ap→staA CTS (Duration 132 µs) delivered',
        'ap→staB CTS (Duration 132 µs) delivered',
        'staA→ap Data (ToDS=1) to router delivered',
        'ap→staA Ack delivered',
      ])
    })

    it('アドホック: AP を使わず、認証もアソシエーションもない', () => {
      const steps = build('adhoc')
      expect(flow(steps)).toEqual([
        'staA→staB Beacon (IBSS example-adhoc) delivered',
        'staB→staA Beacon (IBSS example-adhoc) delivered',
        'staA→staB Data (ToDS=0, FromDS=0) delivered',
        'staB→staA Ack delivered',
      ])
      expect(messages(steps).some((m) => m.from === 'ap' || m.to === 'ap')).toBe(false)
    })
  })

  describe('スキャンとアソシエーション', () => {
    it('ビーコンはブロードキャストで、BSSID は AP の MAC アドレス。RSNE は CCMP-128 と PSK', () => {
      const beacon = byId(build(), 'beacon-a')
      expect(field(beacon, 'Frame Control')).toBe('0x80 0x00 (Beacon)')
      expect(field(beacon, 'Address 1 (DA)')).toBe('ff:ff:ff:ff:ff:ff')
      expect(field(beacon, 'Address 3 (BSSID)')).toBe(MAC.ap)
      expect(field(beacon, 'Capability')).toBe('ESS=1, IBSS=0, Privacy=1')
      expect(field(beacon, 'RSNE')).toContain('AKM 00-0F-AC:2 (PSK)')
    })

    it('Open System 認証は 2 つのフレームで、アソシエーションで AID 2 をもらう', () => {
      const steps = build()
      expect(field(byId(steps, 'auth-request'), 'Authentication Algorithm')).toBe('0 (Open System)')
      expect(field(byId(steps, 'auth-response'), 'Status Code')).toBe('0 (success)')
      expect(field(byId(steps, 'assoc-response'), 'AID')).toBe('2')
    })

    it('ブロードキャストのフレームのあとには Ack がない。データの区間のユニキャストには Ack が続く', () => {
      for (const situation of SITUATIONS) {
        const all = messages(build(situation))
        all.forEach((message, index) => {
          const toGroup = message.fields.some(
            (f) => f.name.startsWith('Address 1') && isGroupAddress(f.value),
          )
          if (toGroup) {
            expect(all[index + 1]?.label).not.toBe('Ack')
          }
          if (message.label.startsWith('Data') && message.status === 'delivered') {
            const next = all[index + 1]
            expect(next?.label).toBe('Ack')
            expect(next?.from).toBe(message.to)
          }
        })
      }
    })
  })

  describe('4 ウェイハンドシェイク（12.7.6）', () => {
    it('PMK は PBKDF2(HMAC-SHA1, パスフレーズ, SSID, 4096, 256)。Annex J.4 のテストベクタも再現する', async () => {
      expect(await psk('password', 'IEEE')).toBe(
        'f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e',
      )
      expect(await psk('ThisIsAPassword', 'ThisIsASSID')).toBe(
        '0dc0d6eb90555ed6419756b9a15ec3e3209b63df707dd508d14581f8982721af',
      )
      expect(await psk(PASSPHRASE, SSID)).toBe(PMK)
      expect(await psk(WRONG_PASSPHRASE, SSID)).toBe(WRONG_PMK)
    })

    it('Key Information とリプレイカウンター、ANonce はメッセージ 1 と 3 で同じ', () => {
      const steps = build()
      const ids = ['message-1', 'message-2', 'message-3', 'message-4']
      expect(ids.map((id) => field(byId(steps, id), 'Key Information')?.slice(0, 6))).toEqual([
        '0x008a',
        '0x010a',
        '0x13ca',
        '0x030a',
      ])
      expect(ids.map((id) => field(byId(steps, id), 'Key Replay Counter'))).toEqual([
        '1',
        '1',
        '2',
        '2',
      ])
      expect(field(byId(steps, 'message-1'), 'Key MIC')).toBe('0 (no PTK yet)')
      expect(field(byId(steps, 'message-3'), 'Key Nonce')).toBe('ANonce (same as message 1)')
    })

    it('EAPOL-Key は保護されないデータフレーム（メッセージ 3 も、中の Key Data だけが暗号化される）', () => {
      const steps = build()
      expect(field(byId(steps, 'message-1'), 'Frame Control')).toBe('0x08 0x02 (Data, FromDS=1)')
      expect(field(byId(steps, 'message-2'), 'Frame Control')).toBe('0x08 0x01 (Data, ToDS=1)')
      for (const id of ['message-1', 'message-2', 'message-3', 'message-4']) {
        expect(byId(steps, id)?.encrypted).toBeUndefined()
        expect(field(byId(steps, id), 'LLC/SNAP EtherType')).toBe('0x888e (EAPOL)')
      }
      expect(field(byId(steps, 'message-3'), 'Key Data')).toContain('wrapped with the KEK')
    })

    it('正常なら両者が State 4 になり、ポートが開く', () => {
      const { staA, ap } = final(build())
      expect(staA?.state).toBe('State 4 (RSNA established)')
      expect(staA?.port).toBe('open')
      expect(ap?.stations).toEqual({
        columns: ['MAC', 'State', 'AID'],
        rows: [
          [MAC.staB, 'State 4', '1'],
          [MAC.staA, 'State 4', '2'],
        ],
      })
    })

    it('パスフレーズの誤り: メッセージ 3 はなく、State 1 に戻る', () => {
      const steps = build('wrongPassphrase')
      expect(messages(steps).some((m) => m.id === 'message-3')).toBe(false)
      expect(byId(steps, 'message-1-again')?.retransmitOf).toBe('message-1')
      expect(field(byId(steps, 'message-2-again'), 'Key Replay Counter')).toBe('2')
      expect(field(byId(steps, 'deauth'), 'Reason Code')).toBe('15 (4-way handshake timeout)')
      const { staA, ap } = final(steps)
      expect(staA?.state).toBe('State 1 (unauthenticated)')
      expect(ap?.stations).toEqual({
        columns: ['MAC', 'State', 'AID'],
        rows: [[MAC.staB, 'State 4', '1']],
      })
    })
  })

  describe('データフレーム', () => {
    it('AP 宛ては ToDS=1（BSSID、SA、DA）、AP からは FromDS=1（DA、BSSID、SA）。どちらも暗号化される', () => {
      const steps = build()
      const up = byId(steps, 'data-a')
      expect(field(up, 'Frame Control')).toBe('0x08 0x41 (Data, ToDS=1, Protected=1)')
      expect(
        ['Address 1 (BSSID)', 'Address 2 (SA)', 'Address 3 (DA)'].map((n) => field(up, n)),
      ).toEqual([MAC.ap, MAC.staA, MAC.staB])
      const down = byId(steps, 'relay')
      expect(field(down, 'Frame Control')).toBe('0x08 0x42 (Data, FromDS=1, Protected=1)')
      expect(
        ['Address 1 (DA)', 'Address 2 (BSSID)', 'Address 3 (SA)'].map((n) => field(down, n)),
      ).toEqual([MAC.staB, MAC.ap, MAC.staA])
      expect([up?.encrypted, down?.encrypted]).toEqual([true, true])
      expect(field(up, 'Duration')).toBe(`${String(DATA_DURATION_US)} µs (SIFS + Ack)`)
      expect(byId(steps, 'ack')?.encrypted).toBeUndefined()
    })

    it('Ack の消失: 再送は同じシーケンス番号と PN で、CW は 15 から 31 になる', () => {
      const steps = build('lostAck')
      const original = byId(steps, 'data-a')
      const retry = byId(steps, 'data-a-retry')
      expect(retry?.retransmitOf).toBe('data-a')
      expect(field(retry, 'Frame Control')).toBe('0x08 0x49 (Data, ToDS=1, Retry=1, Protected=1)')
      expect(['Sequence Number', 'CCMP PN'].map((n) => field(retry, n))).toEqual(
        ['Sequence Number', 'CCMP PN'].map((n) => field(original, n)),
      )
      const timeout = steps.find((step) => step.id === 'ack-timeout')
      expect(timeout?.events).toContainEqual({
        kind: 'stateChange',
        actorId: 'staA',
        key: 'medium',
        value: 'no Ack: DIFS 34 µs + 12 × 9 µs (CW 31)',
      })
      const retryStep = steps.findIndex((step) => step.id === 'retry')
      const state = deriveState(wifiScenario.actors, steps, retryStep)
      expect(state.actorStates.ap?.values.lastFrame).toBe('duplicate discarded (seq 1)')
    })

    it('RTS/CTS: Duration は 176 µs と 132 µs。宛先でない STA の NAV は CTS の Duration', () => {
      const steps = build('rtsCts')
      expect([RTS_DURATION_US, CTS_DURATION_US]).toEqual([176, 132])
      const overheard = byId(steps, 'cts-b-overheard')
      expect(overheard?.to).toBe('staA')
      expect(field(overheard, 'Address 1 (RA)')).toBe(MAC.staB)
      const ctsStep = steps.findIndex((step) => step.id === 'cts-b')
      const state = deriveState(wifiScenario.actors, steps, ctsStep)
      expect(state.actorStates.staA?.values.medium).toBe(`NAV ${String(CTS_DURATION_US)} µs (busy)`)
    })

    it('電波の届く相手: 隠れ端末では STA どうしが届かず、STA A から STA B への矢印はない', () => {
      for (const situation of ['hiddenNode', 'rtsCts'] as const) {
        const steps = build(situation)
        const { staA, staB } = final(steps)
        expect([staA?.hears, staB?.hears]).toEqual(['AP', 'AP'])
        expect(
          messages(steps).some(
            (m) => (m.from === 'staA' && m.to === 'staB') || (m.from === 'staB' && m.to === 'staA'),
          ),
        ).toBe(false)
      }
      const { staA, staB } = final(build())
      expect([staA?.hears, staB?.hears]).toEqual(['AP, STA B', 'AP, STA A'])
    })

    it('アドホック: ToDS=0、FromDS=0、Address 3 はローカルに管理された乱数の BSSID。暗号化しない', () => {
      const steps = build('adhoc')
      const data = byId(steps, 'data')
      expect(field(data, 'Frame Control')).toBe('0x08 0x00 (Data)')
      expect(
        ['Address 1 (DA)', 'Address 2 (SA)', 'Address 3 (BSSID)'].map((n) => field(data, n)),
      ).toEqual([MAC.staB, MAC.staA, IBSS_BSSID])
      expect(data?.encrypted).toBeUndefined()
      expect(field(data, 'MPDU length')).toBe('136 bytes')
      expect(isLocallyAdministered(IBSS_BSSID)).toBe(true)
      expect(isGroupAddress(IBSS_BSSID)).toBe(false)
      expect(field(byId(steps, 'beacon-a'), 'Capability')).toBe('ESS=0, IBSS=1, Privacy=0')
      expect(final(steps).ap?.bss).toBe('not used')
    })
  })
})
