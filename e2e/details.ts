import type { Page } from '@playwright/test'

/** 折りたたんだ中身（パケットの層、道筋のテーマの一覧）も確かめるため、ページのすべての details を開く */
export const openAllDetails = (page: Page) =>
  page.locator('details').evaluateAll((elements) => {
    for (const element of elements) {
      if (element instanceof HTMLDetailsElement) element.open = true
    }
  })
