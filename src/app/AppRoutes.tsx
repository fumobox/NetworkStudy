import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
// テーマのページ（シナリオエンジン・Radix の部品・アニメーション）は、開いたときに読み込む
const ThemePage = lazy(() =>
  import('@/pages/ThemePage').then((module) => ({ default: module.ThemePage })),
)
import { LocaleLayout } from './LocaleLayout'
import { LocaleRedirect } from './LocaleRedirect'

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LocaleRedirect />} />
      {/* 先頭セグメントが対応ロケールでなければ LocaleLayout がリダイレクトする */}
      <Route path=":locale" element={<LocaleLayout />}>
        <Route index element={<HomePage />} />
        <Route path="themes/:theme" element={<ThemePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* `//en` のように先頭セグメントが空のパスは :locale にマッチしないため、ここで受ける */}
      <Route path="*" element={<LocaleRedirect />} />
    </Routes>
  )
}
