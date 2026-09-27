import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
import { useText } from '@/lib/i18n'
import type { LocalizedText } from '@/lib/i18n/locale'
import { cn } from '@/lib/utils'
import {
  classify,
  DEFAULT_ADDRESS,
  eui64FromMac,
  formatCanonical,
  formatFull,
  formatMac,
  interfaceId,
  linkLocalFromMac,
  macFromEui64,
  MAX_PREFIX,
  MIN_PREFIX,
  multicastMac,
  multicastScope,
  networkPrefix,
  parseIPv6,
  parseMac,
  readIpv6Query,
  solicitedNode,
  UL_BIT,
  wellKnownGroup,
  type Groups,
} from './ipv6'
import { IPV6_TEXT as TEXT } from './ipv6Text'

/** 試すアドレス（種類がひととおり出るように選ぶ） */
const EXAMPLES = [
  DEFAULT_ADDRESS,
  'fe80::200:5eff:fe00:530a',
  '::1',
  'ff02::1',
  'ff02::1:ff00:530a',
  'fd12:3456:789a::1',
  '::ffff:192.0.2.1',
] as const
const DEFAULT_MAC = '00:00:5e:00:53:0a'
const GROUP_SEPARATOR = ':'
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive'

/** 入力中の値。base は入力したときの URL の値 */
interface Draft<T> {
  readonly base: T
  readonly text: string
}

/** IPv6 アドレスの表記と種類を調べるツール。アドレスとプレフィックス長を URL のクエリ（`?address=&prefix=`）と同期する */
export function Ipv6Address() {
  const t = useText()
  const baseId = useId()
  const [params, setParams] = useSearchParams()
  const query = readIpv6Query(params)
  // 下書きの考え方は SubnetCalculator と同じ（URL が外から変わったら下書きを捨てる）
  const [addressDraft, setAddressDraft] = useState<Draft<string> | null>(null)
  const [prefixDraft, setPrefixDraft] = useState<Draft<number> | null>(null)
  const addressText = addressDraft?.base === query.address ? addressDraft.text : query.address
  const prefixText = prefixDraft?.base === query.prefix ? prefixDraft.text : String(query.prefix)
  const addressInvalid = parseIPv6(addressText) === null
  const groups = parseIPv6(query.address) ?? parseIPv6(DEFAULT_ADDRESS)

  const writeQuery = (next: { address?: string; prefix?: number }) => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        updated.set('address', next.address ?? query.address)
        updated.set('prefix', String(next.prefix ?? query.prefix))
        return updated
      },
      { replace: true },
    )
  }

  const ids = {
    title: `${baseId}-title`,
    address: `${baseId}-address`,
    addressHint: `${baseId}-address-hint`,
    addressError: `${baseId}-address-error`,
    prefix: `${baseId}-prefix`,
    prefixHint: `${baseId}-prefix-hint`,
  }

  return (
    <section aria-labelledby={ids.title} className="space-y-6">
      <h2 id={ids.title} className="font-heading text-xl font-semibold">
        {t(TEXT.title)}
      </h2>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label htmlFor={ids.address}>{t(TEXT.address)}</Label>
          <input
            id={ids.address}
            value={addressText}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={addressInvalid}
            aria-describedby={
              addressInvalid ? `${ids.addressHint} ${ids.addressError}` : ids.addressHint
            }
            onChange={(event) => {
              const text = event.target.value
              setAddressDraft({ base: query.address, text })
              if (parseIPv6(text) !== null) {
                writeQuery({ address: text.trim() })
              }
            }}
            className={INPUT_CLASS}
          />
          <p id={ids.addressHint} className="text-xs text-muted-foreground">
            {t(TEXT.addressHint)}
          </p>
          {addressInvalid && (
            <p id={ids.addressError} className="text-xs text-destructive">
              {t(TEXT.addressInvalid)}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.prefix}>{t(TEXT.prefix)}</Label>
          <input
            id={ids.prefix}
            type="number"
            min={MIN_PREFIX}
            max={MAX_PREFIX}
            value={prefixText}
            aria-describedby={ids.prefixHint}
            onChange={(event) => {
              const text = event.target.value
              const prefix = Number(text)
              // 空欄は打ち直しの途中なので残す。範囲外などの不正な値は受け付けず、表示を URL の値に戻す
              if (text === '') {
                setPrefixDraft({ base: query.prefix, text })
              } else if (Number.isInteger(prefix) && prefix >= MIN_PREFIX && prefix <= MAX_PREFIX) {
                writeQuery({ prefix })
              }
            }}
            className={cn(INPUT_CLASS, 'w-24')}
          />
          <p id={ids.prefixHint} className="text-xs text-muted-foreground">
            {t(TEXT.prefixHint)}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t(TEXT.examples)}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              aria-pressed={groups !== null && formatCanonical(groups) === example}
              onClick={() => {
                writeQuery({ address: example })
              }}
              className="rounded-md border px-2 py-0.5 font-mono hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
      {groups !== null && <Results groups={groups} prefix={query.prefix} />}
      {groups !== null && <BinaryView groups={groups} prefix={query.prefix} />}
      <MacToInterfaceId
        onUse={(address) => {
          writeQuery({ address, prefix: 64 })
        }}
      />
    </section>
  )
}

type Row = readonly [LocalizedText, string, LocalizedText?]

function Results({ groups, prefix }: { groups: Groups; prefix: number }) {
  const t = useText()
  const { kind, range } = classify(groups)
  const unicast = !['multicast', 'unspecified', 'ipv4Mapped', 'reserved'].includes(kind)
  const eui64 = macFromEui64(groups)
  const rows: Row[] = [
    [TEXT.rows.canonical, formatCanonical(groups), TEXT.canonicalNote],
    [TEXT.rows.full, formatFull(groups)],
    [
      TEXT.rows.kind,
      t(range === null ? TEXT.kinds[kind] : TEXT.kindWithRange(TEXT.kinds[kind], range)),
      TEXT.kindNotes[kind],
    ],
  ]
  if (kind === 'multicast') {
    const group = wellKnownGroup(groups)
    rows.push(
      [TEXT.rows.scope, t(TEXT.scopes[multicastScope(groups)])],
      [TEXT.rows.group, group === null ? t(TEXT.none) : t(TEXT.groups[group])],
      [TEXT.rows.multicastMac, multicastMac(groups)],
    )
  } else {
    rows.push(
      [TEXT.rows.prefix, `${formatCanonical(networkPrefix(groups, prefix))}/${String(prefix)}`],
      [TEXT.rows.interfaceId, formatCanonical(interfaceId(groups, prefix))],
    )
  }
  if (unicast) {
    const solicited = solicitedNode(groups)
    rows.push(
      [TEXT.rows.solicitedNode, formatCanonical(solicited), TEXT.solicitedNodeNote],
      [TEXT.rows.multicastMac, multicastMac(solicited)],
      [TEXT.rows.eui64, t(eui64 === null ? TEXT.eui64No : TEXT.eui64Yes(formatMac(eui64)))],
    )
  }
  return (
    <section className="space-y-2" aria-live="polite">
      <h3 className="text-base font-semibold">{t(TEXT.results)}</h3>
      <dl className="text-sm">
        {rows.map(([label, value, note]) => (
          <div
            key={label.en}
            className="grid grid-cols-[minmax(9rem,auto)_minmax(0,1fr)] items-baseline gap-x-3 border-t px-1 py-2"
          >
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="font-mono break-words">{value}</dd>
            {note !== undefined && (
              <dd className="col-start-2 mt-0.5 text-xs text-muted-foreground">{t(note)}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}

function BinaryView({ groups, prefix }: { groups: Groups; prefix: number }) {
  const t = useText()
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{t(TEXT.binary)}</h3>
      <p className="text-sm text-muted-foreground">{t(TEXT.binaryLead(prefix))}</p>
      <div className="overflow-x-auto">
        <p className="font-mono text-xs leading-6 break-all" data-testid="ipv6-bits">
          {groups.map((group, groupIndex) => (
            <span key={groupIndex}>
              {groupIndex > 0 && <span className="text-muted-foreground">{GROUP_SEPARATOR}</span>}
              {Array.from(group.toString(2).padStart(16, '0'), (bit, bitIndex) => (
                <span
                  key={bitIndex}
                  className={cn(
                    groupIndex * 16 + bitIndex < prefix
                      ? 'font-bold text-primary underline decoration-2 underline-offset-4'
                      : 'text-muted-foreground',
                  )}
                >
                  {bit}
                </span>
              ))}
            </span>
          ))}
        </p>
      </div>
    </section>
  )
}

function MacToInterfaceId({ onUse }: { onUse: (address: string) => void }) {
  const t = useText()
  const baseId = useId()
  const [text, setText] = useState(DEFAULT_MAC)
  const mac = parseMac(text)
  const ids = { input: `${baseId}-mac`, error: `${baseId}-mac-error` }
  const byteBits = (byte: number) =>
    Array.from(byte.toString(2).padStart(8, '0'), (bit, i) => (
      <span
        key={i}
        // U/L ビットは下から 2 ビット目（左から 7 ビット目）
        className={cn(
          i === 6 && 'font-bold text-primary underline decoration-2 underline-offset-4',
        )}
      >
        {bit}
      </span>
    ))
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{t(TEXT.mac.title)}</h3>
      <p className="text-sm text-muted-foreground">{t(TEXT.mac.lead)}</p>
      <div className="max-w-sm space-y-2">
        <Label htmlFor={ids.input}>{t(TEXT.mac.input)}</Label>
        <input
          id={ids.input}
          value={text}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={mac === null}
          aria-describedby={mac === null ? ids.error : undefined}
          onChange={(event) => {
            setText(event.target.value)
          }}
          className={INPUT_CLASS}
        />
        {mac === null && (
          <p id={ids.error} className="text-xs text-destructive">
            {t(TEXT.mac.invalid)}
          </p>
        )}
      </div>
      {mac !== null && (
        <dl className="text-sm">
          {(
            [
              [TEXT.mac.firstByte, <span key="b">{byteBits(mac[0])}</span>],
              [TEXT.mac.flipped, <span key="f">{byteBits(mac[0] ^ UL_BIT)}</span>],
              [
                TEXT.mac.interfaceId,
                eui64FromMac(mac)
                  .map((g) => g.toString(16))
                  .join(':'),
              ],
              [TEXT.mac.linkLocal, formatCanonical(linkLocalFromMac(mac))],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label.en}
              className="grid grid-cols-[minmax(9rem,auto)_minmax(0,1fr)] items-baseline gap-x-3 border-t px-1 py-2"
            >
              <dt className="text-xs text-muted-foreground">{t(label)}</dt>
              <dd className="font-mono break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {mac !== null && (
        <button
          type="button"
          onClick={() => {
            onUse(formatCanonical(linkLocalFromMac(mac)))
          }}
          className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
        >
          {t(TEXT.mac.use)}
        </button>
      )}
      <p className="text-xs text-muted-foreground">{t(TEXT.mac.note)}</p>
    </section>
  )
}
