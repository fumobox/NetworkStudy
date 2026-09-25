import { Route, Routes } from 'react-router'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { LocaleLayout } from './LocaleLayout'
import { LocaleRedirect } from './LocaleRedirect'

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LocaleRedirect />} />
      {/* 先頭セグメントが対応ロケールでなければ LocaleLayout がリダイレクトする */}
      <Route path=":locale" element={<LocaleLayout />}>
        <Route index element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
