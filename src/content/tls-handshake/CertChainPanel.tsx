import { ArrowDown, Check, CircleHelp, Minus, X } from 'lucide-react'
import { useId } from 'react'
import type { ScenarioPanelsContext } from '@/engine/ui/ScenarioPlayer'
import { useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CERT_CHAIN_TEXT as TEXT } from './certChainText'
import {
  CANNOT_CHECK,
  CERT_CHAIN,
  CERT_CHAIN_COLUMNS,
  CHECK_NG,
  CHECK_OK,
  NOT_SENT,
} from './scenario'

type Column = (typeof CERT_CHAIN_COLUMNS)[number]
type CheckColumn = Extract<Column, 'signature' | 'validity' | 'name' | 'trust'>

/** 証明書ごとに意味のある検証項目（サーバー証明書・中間 CA・ルート CA の順） */
const CHECKS_BY_ROLE: readonly (readonly CheckColumn[])[] = [
  ['signature', 'validity', 'name'],
  ['signature', 'validity'],
  ['validity', 'trust'],
]

function columnIndex(column: Column): number {
  return CERT_CHAIN_COLUMNS.indexOf(column)
}

/** TLS のクライアントの証明書チェーンの検証結果を、証明書ごとに順に見せる */
export function CertChainPanel({ derived }: ScenarioPanelsContext) {
  const t = useText()
  const titleId = useId()
  const chain = derived.actorStates.client?.values[CERT_CHAIN]
  const rows = typeof chain === 'object' ? chain.rows : []
  const cell = (row: readonly string[], column: Column) => row[columnIndex(column)] ?? ''

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="font-heading text-base font-semibold">
          {t(TEXT.title)}
        </h2>
        <p className="text-xs text-muted-foreground">{t(TEXT.checkedAt)}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(TEXT.notReceived)}</p>
      ) : (
        <ol className="space-y-1">
          {rows.map((row, i) => {
            const role = TEXT.roles[i]
            const notSent = cell(row, 'issuer') === NOT_SENT
            return (
              <li key={`${String(i)}:${cell(row, 'subject')}`}>
                {i > 0 && (
                  <p className="flex items-center gap-1 py-1 pl-4 text-xs text-muted-foreground">
                    <ArrowDown aria-hidden className="size-3.5" />
                    {t(TEXT.issuedBy)}
                  </p>
                )}
                <article
                  className={cn(
                    'rounded-lg border p-3',
                    notSent && 'border-dashed text-muted-foreground',
                  )}
                >
                  {/* 見出しに役割も含め、見出しで移動したときに「サーバー証明書」などがわかるようにする */}
                  <h3 className="mb-2">
                    {role !== undefined && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t(role)}
                      </span>
                    )}
                    <span className="block font-mono text-sm font-semibold">
                      {cell(row, 'subject')}
                    </span>
                  </h3>
                  {notSent ? (
                    <p className="text-sm">{t(TEXT.notSent)}</p>
                  ) : (
                    <>
                      <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-muted-foreground">{t(TEXT.issuedBy)}</dt>
                        <dd className="font-mono">{cell(row, 'issuer')}</dd>
                        <dt className="text-muted-foreground">{t(TEXT.validUntil)}</dt>
                        <dd className="font-mono">{cell(row, 'notAfter')}</dd>
                        {i === 0 && (
                          <>
                            <dt className="text-muted-foreground">{t(TEXT.names)}</dt>
                            <dd className="font-mono">{cell(row, 'subjectAltName')}</dd>
                          </>
                        )}
                      </dl>
                      <ul className="space-y-1">
                        {(CHECKS_BY_ROLE[i] ?? []).map((check) => (
                          <CheckItem
                            key={check}
                            label={t(TEXT.checks[check])}
                            value={cell(row, check)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function CheckItem({ label, value }: { label: string; value: string }) {
  const t = useText()
  const result =
    value === CHECK_OK
      ? { icon: Check, text: TEXT.results.ok, className: 'text-foreground' }
      : value === CHECK_NG
        ? { icon: X, text: TEXT.results.ng, className: 'font-semibold text-destructive' }
        : value === CANNOT_CHECK
          ? {
              icon: CircleHelp,
              text: TEXT.results.unknown,
              className: 'font-semibold text-destructive',
            }
          : { icon: Minus, text: TEXT.results.pending, className: 'text-muted-foreground' }
  const Icon = result.icon
  return (
    <li className={cn('flex items-center gap-2 text-sm', result.className)} data-result={value}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>{label}</span>
      <span className="ml-auto text-xs">{t(result.text)}</span>
    </li>
  )
}
