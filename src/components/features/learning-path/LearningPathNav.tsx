import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useId } from 'react'
import { Link, NavLink } from 'react-router'
import { themeSearch, type PathContext, type PathPosition } from '@/content/learningPathNav'
import type { LearningPathId } from '@/content/learningPaths'
import { THEME_META } from '@/content/themeMeta'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** 道筋の名前と位置の間の区切り（読み上げない） */
const SEPARATOR = ' · '
/** リンクの名前（読み上げ）で「前のテーマ」とテーマの名前がつながらないようにする空白。flex の中なので見た目は変わらない */
const SPACE = ' '

function useThemeTitle() {
  const t = useText()
  return (id: string) => {
    const meta = THEME_META.find((candidate) => candidate.id === id)
    return meta === undefined ? id : t(meta.title)
  }
}

function useThemeLink() {
  const locale = useLocale()
  return (id: string, pathId: LearningPathId) => ({
    pathname: localePath(locale, `/themes/${id}`),
    search: themeSearch(pathId),
  })
}

/** テーマのページの見出しの下に出す、道筋の中の位置（1 つの道筋のときだけ） */
export function PathPositionLine({ position }: { position: PathPosition }) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()
  return (
    <span>
      <Link to={localePath(locale, `/paths/${position.path.id}`)} className="underline">
        {t(position.path.title)}
      </Link>
      <span aria-hidden>{SEPARATOR}</span>
      {m.pathNav.position({ current: position.index + 1, total: position.total })}
    </span>
  )
}

/** テーマのページの最後に置く、道筋の中の前後のテーマへのナビゲーション */
export function LearningPathNav({ context }: { context: PathContext }) {
  if (context.kind === 'none') {
    return null
  }
  return context.kind === 'single' ? (
    <SinglePathNav position={context.position} />
  ) : (
    <SeveralPathsNav positions={context.positions} />
  )
}

function SinglePathNav({ position }: { position: PathPosition }) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()
  const title = useThemeTitle()
  const link = useThemeLink()
  const headingId = useId()
  const { path, previous, next } = position

  return (
    <nav aria-labelledby={headingId} className="space-y-4">
      <div className="space-y-1">
        <h2 id={headingId} className="font-heading text-2xl font-bold tracking-tight">
          {m.pathNav.label({ path: t(path.title) })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {m.pathNav.position({ current: position.index + 1, total: position.total })}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {previous !== null && (
          <Link
            to={link(previous, path.id)}
            className="flex min-h-11 flex-col gap-1 rounded-lg border p-3 break-words transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowLeft aria-hidden className="size-3" />
              {m.pathNav.previous}
            </span>
            {SPACE}
            <span className="font-medium">{title(previous)}</span>
          </Link>
        )}
        {next === null ? (
          <div className="flex min-h-11 flex-col gap-1 rounded-lg border border-dashed p-3 sm:col-start-2">
            <p className="text-sm">{m.pathNav.finished}</p>
            <Link to={localePath(locale, `/paths/${path.id}`)} className="text-sm underline">
              {m.pathNav.backToPath}
            </Link>
          </div>
        ) : (
          <Link
            to={link(next, path.id)}
            className="flex min-h-11 flex-col gap-1 rounded-lg border p-3 break-words transition-colors hover:bg-muted/50 sm:col-start-2 sm:text-right"
          >
            <span className="flex items-center gap-1 text-xs text-muted-foreground sm:justify-end">
              {m.pathNav.next}
              <ArrowRight aria-hidden className="size-3" />
            </span>
            {SPACE}
            <span className="font-medium">{title(next)}</span>
          </Link>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{m.pathNav.showAll}</summary>
        {/* Safari（VoiceOver）でリストの意味を保つため role="list" を付ける */}
        <ol role="list" className="mt-2 list-decimal space-y-1 pl-6">
          {path.themeIds.map((id) => (
            <li key={id}>
              {/* NavLink はパスだけを比べるので、今のテーマに aria-current="page" が付く */}
              <NavLink
                to={link(id, path.id)}
                className={({ isActive }) => cn(isActive ? 'font-semibold' : 'underline')}
              >
                {title(id)}
              </NavLink>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  )
}

function SeveralPathsNav({ positions }: { positions: readonly PathPosition[] }) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()
  const title = useThemeTitle()
  const link = useThemeLink()
  const headingId = useId()

  return (
    <nav aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="font-heading text-2xl font-bold tracking-tight">
        {m.pathNav.inPathsTitle}
      </h2>
      <ul role="list" className="space-y-3">
        {positions.map((position) => (
          <li key={position.path.id} className="space-y-1 rounded-lg border p-3 text-sm">
            <p>
              <Link
                to={localePath(locale, `/paths/${position.path.id}`)}
                className="font-medium underline"
              >
                {t(position.path.title)}
              </Link>
              <span aria-hidden>{SEPARATOR}</span>
              <span className="text-muted-foreground">
                {m.pathNav.position({ current: position.index + 1, total: position.total })}
              </span>
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {position.previous !== null && (
                <Link to={link(position.previous, position.path.id)} className="underline">
                  <ArrowLeft aria-hidden className="mr-1 inline size-3" />
                  {m.pathNav.previousTo({ title: title(position.previous) })}
                </Link>
              )}
              {position.next === null ? (
                <span className="text-muted-foreground">{m.pathNav.finished}</span>
              ) : (
                <Link to={link(position.next, position.path.id)} className="underline">
                  {m.pathNav.nextTo({ title: title(position.next) })}
                  <ArrowRight aria-hidden className="ml-1 inline size-3" />
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </nav>
  )
}
