import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

/**
 * スモークテスト（e2e/）。ビルド済みの dist を vite preview で配信して確かめる。
 * 先に `npm run build` を実行しておく（静的ページ生成後の dist で、直リンクも本番と同じく確かめるため）
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}/NetworkStudy/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}/NetworkStudy/`,
    reuseExistingServer: !process.env.CI,
  },
})
