import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { formatIPv4, parseIPv4, toBinaryOctets } from '../subnet-calculator/subnet'
import { ROUTE_TEXT as TEXT } from './routeText'
import {
  lookupRoute,
  nextHopOf,
  readRouteQuery,
  ROUTE_TABLE_IDS,
  ROUTE_TABLES,
  type Route,
  type RouteTableId,
} from './routing'

/** 選ばれた経路の印（色だけに頼らない） */
const SELECTED_MARK = '▶'
const OCTET_SEPARATOR = '.'
/** 試す宛先（経路表ごと。最長一致・デフォルト経路・ホスト経路・メトリックを順に見せる） */
const EXAMPLES: Readonly<Record<RouteTableId, readonly string[]>> = {
  pc: ['192.168.1.20', '192.0.2.10'],
  router: ['192.168.1.20', '192.168.2.5', '192.168.7.1', '192.0.2.10', '192.0.2.53', '10.1.2.3'],
}

function prefixText(route: Pick<Route, 'network' | 'length'>): string {
  return `${formatIPv4(route.network)}/${String(route.length)}`
}

/** 入力中の値。base は入力したときの URL の値 */
interface Draft {
  readonly base: string
  readonly text: string
}

/** 経路表の最長一致を試すツール。宛先と経路表を URL のクエリ（`?dst=&table=`）と同期する */
export function RouteLookup() {
  const t = useText()
  const baseId = useId()
  const [params, setParams] = useSearchParams()
  const query = readRouteQuery(params)
  // 下書きの考え方は SubnetCalculator と同じ（URL が外から変わったら下書きを捨てる）
  const [draft, setDraft] = useState<Draft | null>(null)
  const destinationText = draft?.base === query.dst ? draft.text : query.dst
  const invalid = parseIPv4(destinationText) === null
  const destination = parseIPv4(query.dst) ?? 0

  const writeQuery = (next: { dst?: string; table?: RouteTableId }) => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        updated.set('dst', next.dst ?? query.dst)
        updated.set('table', next.table ?? query.table)
        return updated
      },
      { replace: true },
    )
  }

  const ids = {
    title: `${baseId}-title`,
    destination: `${baseId}-destination`,
    hint: `${baseId}-hint`,
    error: `${baseId}-error`,
    table: `${baseId}-table`,
  }

  return (
    <section aria-labelledby={ids.title} className="space-y-6">
      <h2 id={ids.title} className="font-heading text-xl font-semibold">
        {t(TEXT.title)}
      </h2>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.destination}>{t(TEXT.destination)}</Label>
          <input
            id={ids.destination}
            value={destinationText}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${ids.hint} ${ids.error}` : ids.hint}
            onChange={(event) => {
              const text = event.target.value
              setDraft({ base: query.dst, text })
              if (parseIPv4(text) !== null) {
                writeQuery({ dst: text })
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          <p id={ids.hint} className="text-xs text-muted-foreground">
            {t(TEXT.destinationHint)}
          </p>
          {invalid && (
            <p id={ids.error} className="text-xs text-destructive">
              {t(TEXT.destinationInvalid)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-muted-foreground">{t(TEXT.examples)}</span>
            {EXAMPLES[query.table].map((example) => (
              <button
                key={example}
                type="button"
                aria-pressed={query.dst === example}
                onClick={() => {
                  writeQuery({ dst: example })
                }}
                className="rounded-md border px-2 py-0.5 font-mono hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t(TEXT.tableChoice)}</legend>
          <RadioGroup
            value={query.table}
            onValueChange={(value) => {
              const table = ROUTE_TABLE_IDS.find((id) => id === value)
              if (table !== undefined) {
                writeQuery({ table })
              }
            }}
          >
            {ROUTE_TABLE_IDS.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <RadioGroupItem id={`${ids.table}-${id}`} value={id} />
                <Label htmlFor={`${ids.table}-${id}`} className="font-normal">
                  {t(TEXT.tables[id])}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      </div>
      {/* 経路表を切り替えたら、行の有効・無効は最初に戻す */}
      <LookupTable key={query.table} table={ROUTE_TABLES[query.table]} destination={destination} />
    </section>
  )
}

function LookupTable({ table, destination }: { table: readonly Route[]; destination: number }) {
  const t = useText()
  const resultId = useId()
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set())
  const routes = table.map((route) => ({ ...route, enabled: !disabled.has(route.id) }))
  const result = lookupRoute(routes, destination)
  const candidates = new Set(result.candidates.map((route) => route.id))
  const selected = result.selected

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t(TEXT.columns.use)}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t(TEXT.columns.prefix)}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t(TEXT.columns.nextHop)}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t(TEXT.columns.iface)}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t(TEXT.columns.metric)}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t(TEXT.columns.match)}
              </th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const isSelected = selected?.id === route.id
              const matches = candidates.has(route.id)
              return (
                <tr
                  key={route.id}
                  data-route={route.id}
                  data-selected={isSelected}
                  className={cn(
                    'border-t',
                    isSelected && 'bg-accent font-semibold',
                    !route.enabled && 'text-muted-foreground line-through',
                  )}
                >
                  <td className="py-1 pr-3">
                    <input
                      type="checkbox"
                      checked={route.enabled}
                      aria-label={t(TEXT.routeLabel(prefixText(route)))}
                      onChange={(event) => {
                        const next = new Set(disabled)
                        if (event.target.checked) {
                          next.delete(route.id)
                        } else {
                          next.add(route.id)
                        }
                        setDisabled(next)
                      }}
                    />
                  </td>
                  <th scope="row" className="py-1 pr-3 font-mono font-normal whitespace-nowrap">
                    {isSelected && (
                      <span aria-hidden className="mr-1 text-primary">
                        {SELECTED_MARK}
                      </span>
                    )}
                    <span className={cn(isSelected && 'font-semibold')}>{prefixText(route)}</span>
                    {isSelected && <span className="sr-only">{t(TEXT.selected)}</span>}
                  </th>
                  <td className="py-1 pr-3 font-mono whitespace-nowrap">
                    {route.nextHop === null ? t(TEXT.directlyConnected) : formatIPv4(route.nextHop)}
                  </td>
                  <td className="py-1 pr-3">{t(TEXT.interfaces[route.iface])}</td>
                  <td className="py-1 pr-3 font-mono">{route.metric}</td>
                  <td className="py-1">{t(matches ? TEXT.matched : TEXT.notMatched)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <section aria-labelledby={resultId} className="space-y-2" aria-live="polite">
        <h3 id={resultId} className="text-base font-semibold">
          {t(TEXT.result)}
        </h3>
        <p className="text-sm">{t(TEXT.reasons[result.reason])}</p>
        {selected !== null && (
          <p className="text-sm">
            {(() => {
              const hop = nextHopOf(selected, destination)
              const address = formatIPv4(hop.address)
              return t(hop.onLink ? TEXT.onLink(address) : TEXT.viaGateway(address))
            })()}
          </p>
        )}
        {selected !== null && <BinaryCompare destination={destination} route={selected} />}
      </section>
    </>
  )
}

function BinaryCompare({ destination, route }: { destination: number; route: Route }) {
  const t = useText()
  const leadId = useId()
  const rows = [
    [TEXT.binaryRows.destination, destination],
    [TEXT.binaryRows.prefix, route.network],
  ] as const
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{t(TEXT.binary)}</h4>
      <p id={leadId} className="text-xs text-muted-foreground">
        {t(TEXT.binaryLead(route.length))}
      </p>
      <div className="overflow-x-auto">
        <table className="font-mono text-sm" aria-describedby={leadId}>
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
                  {toBinaryOctets(value).map((octet, octetIndex) => (
                    <span key={octetIndex}>
                      {octetIndex > 0 && (
                        <span className="text-muted-foreground">{OCTET_SEPARATOR}</span>
                      )}
                      {Array.from(octet, (bit, bitIndex) => (
                        <span
                          key={bitIndex}
                          className={cn(
                            octetIndex * 8 + bitIndex < route.length
                              ? 'font-bold underline decoration-2 underline-offset-4'
                              : 'text-muted-foreground',
                          )}
                        >
                          {bit}
                        </span>
                      ))}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
