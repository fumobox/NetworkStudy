import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { formatNumber, useLocale, useText } from '@/lib/i18n'
import type { LocalizedText } from '@/lib/i18n/locale'
import { cn } from '@/lib/utils'
import {
  describeSubnet,
  formatIPv4,
  isPrefixLength,
  MAX_PREFIX,
  MIN_PREFIX,
  parseIPv4,
  readSubnetQuery,
  toBinaryOctets,
  type SubnetInfo,
} from './subnet'
import { binarySplitText, SUBNET_TEXT as TEXT } from './subnetText'

/** 2 進表記のオクテットの区切り */
const OCTET_SEPARATOR = '.'

/** 凡例に使うビットの並び */
const LEGEND_BITS = '1010'

/** 入力中の値。base は入力したときの URL の値 */
interface Draft<T> {
  readonly base: T
  readonly text: string
}

/** サブネット計算ツール。アドレスとプレフィックス長を URL のクエリ（`?ip=&prefix=`）と同期する */
export function SubnetCalculator() {
  const t = useText()
  const baseId = useId()
  const [params, setParams] = useSearchParams()
  const query = readSubnetQuery(params)
  // 入力中の文字列は、不正でも（プレフィックス長は空でも）残す。URL と計算には、最後に入力した正しい値を使う。
  // 下書きは、入力したときの URL の値（base）と組にして持つ。サイドバーのリンクなどで URL が外から変わったら、下書きを捨てて URL の値を表示する
  const [addressDraft, setAddressDraft] = useState<Draft<string> | null>(null)
  const [prefixDraft, setPrefixDraft] = useState<Draft<number> | null>(null)
  const addressText = addressDraft?.base === query.ip ? addressDraft.text : query.ip
  const prefixText = prefixDraft?.base === query.prefix ? prefixDraft.text : String(query.prefix)
  const address = parseIPv4(query.ip) ?? 0
  const addressInvalid = parseIPv4(addressText) === null
  const info = describeSubnet(address, query.prefix)

  const writeQuery = (next: { ip?: string; prefix?: number }) => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        updated.set('ip', next.ip ?? query.ip)
        updated.set('prefix', String(next.prefix ?? query.prefix))
        return updated
      },
      { replace: true },
    )
  }

  const ids = {
    address: `${baseId}-address`,
    addressHint: `${baseId}-address-hint`,
    addressError: `${baseId}-address-error`,
    prefix: `${baseId}-prefix`,
    prefixHint: `${baseId}-prefix-hint`,
    title: `${baseId}-title`,
  }

  return (
    <section aria-labelledby={ids.title} className="space-y-6">
      <h2 id={ids.title} className="font-heading text-xl font-semibold">
        {t(TEXT.title)}
      </h2>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.address}>{t(TEXT.address)}</Label>
          <input
            id={ids.address}
            value={addressText}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={addressInvalid}
            aria-describedby={
              addressInvalid ? `${ids.addressHint} ${ids.addressError}` : ids.addressHint
            }
            onChange={(event) => {
              const text = event.target.value
              setAddressDraft({ base: query.ip, text })
              if (parseIPv4(text) !== null) {
                writeQuery({ ip: text })
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
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
          <div className="flex items-center gap-3">
            <input
              id={ids.prefix}
              type="number"
              min={MIN_PREFIX}
              max={MAX_PREFIX}
              value={prefixText}
              aria-describedby={ids.prefixHint}
              onChange={(event) => {
                const text = event.target.value
                setPrefixDraft({ base: query.prefix, text })
                const prefix = Number(text)
                if (text !== '' && isPrefixLength(prefix)) {
                  writeQuery({ prefix })
                }
              }}
              className="h-9 w-20 rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Slider
              min={MIN_PREFIX}
              max={MAX_PREFIX}
              step={1}
              value={[query.prefix]}
              aria-label={t(TEXT.prefix)}
              onValueChange={([prefix]) => {
                if (prefix !== undefined) {
                  writeQuery({ prefix })
                }
              }}
            />
          </div>
          <p id={ids.prefixHint} className="text-xs text-muted-foreground">
            {t(TEXT.prefixHint)}
          </p>
        </div>
      </div>
      <ResultTable info={info} />
      <BinaryView info={info} />
    </section>
  )
}

function ResultTable({ info }: { info: SubnetInfo }) {
  const t = useText()
  const locale = useLocale()
  const hasBroadcast = info.prefix < MAX_PREFIX - 1
  const rows: readonly (readonly [LocalizedText, string, LocalizedText?])[] = [
    [TEXT.rows.cidr, `${formatIPv4(info.network)}/${String(info.prefix)}`],
    [TEXT.rows.mask, formatIPv4(info.mask)],
    [TEXT.rows.wildcard, formatIPv4(info.wildcard)],
    [TEXT.rows.network, formatIPv4(info.network)],
    [TEXT.rows.broadcast, hasBroadcast ? formatIPv4(info.broadcast) : t(TEXT.noBroadcast)],
    [TEXT.rows.firstHost, formatIPv4(info.hosts.first)],
    [TEXT.rows.lastHost, formatIPv4(info.hosts.last)],
    [TEXT.rows.hostCount, formatNumber(locale, info.hosts.count), TEXT.hostCountNote],
    [TEXT.rows.addressClass, info.addressClass],
    [TEXT.rows.private, t(info.isPrivate ? TEXT.yes : TEXT.no)],
  ]
  return (
    <section className="space-y-2">
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

function BinaryView({ info }: { info: SubnetInfo }) {
  const t = useText()
  const splitId = useId()
  const rows = [
    [TEXT.binaryRows.address, info.address],
    [TEXT.binaryRows.mask, info.mask],
    [TEXT.binaryRows.network, info.network],
  ] as const
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{t(TEXT.binary)}</h3>
      <p className="text-sm text-muted-foreground">{t(TEXT.binaryLead)}</p>
      <p id={splitId} className="text-sm">
        {t(binarySplitText(info.prefix))}
      </p>
      {/* ネットワーク部は太字と下線、ホスト部は淡い色で示す（色だけに頼らない） */}
      <ul className="flex flex-wrap gap-4 text-xs" aria-hidden>
        <li>
          <span className="mr-1 font-mono font-bold underline decoration-2 underline-offset-4">
            {LEGEND_BITS}
          </span>
          {t(TEXT.networkPart)}
        </li>
        <li>
          <span className="mr-1 font-mono text-muted-foreground">{LEGEND_BITS}</span>
          {t(TEXT.hostPart)}
        </li>
      </ul>
      <div className="overflow-x-auto">
        <table className="font-mono text-sm" aria-describedby={splitId}>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label.en}>
                <th
                  scope="row"
                  className="pr-3 text-left font-sans text-xs font-normal text-muted-foreground"
                >
                  {t(label)}
                </th>
                <td className="py-1 whitespace-nowrap">
                  <BinaryBits value={value} networkBits={info.prefix} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BinaryBits({ value, networkBits }: { value: number; networkBits: number }) {
  return (
    <>
      {toBinaryOctets(value).map((octet, octetIndex) => (
        <span key={octetIndex}>
          {octetIndex > 0 && <span className="text-muted-foreground">{OCTET_SEPARATOR}</span>}
          {Array.from(octet, (bit, bitIndex) => {
            const isNetwork = octetIndex * 8 + bitIndex < networkBits
            return (
              <span
                key={bitIndex}
                className={cn(
                  isNetwork
                    ? 'font-bold underline decoration-2 underline-offset-4'
                    : 'text-muted-foreground',
                )}
              >
                {bit}
              </span>
            )
          })}
        </span>
      ))}
    </>
  )
}
