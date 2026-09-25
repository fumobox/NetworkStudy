import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Vitest はテスト時に base を '/' に上書きする（import.meta.env.BASE_URL === '/'）。
      // ルーティングのテストは MemoryRouter を使い、basename（/NetworkStudy/）は扱わない
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // 遅延読み込みのページと MDX の初回の変換は、負荷が高いと数秒かかることがある（waitForPage の待ち時間より長くする）
      testTimeout: 15_000,
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/components/ui/**', 'src/test/**', 'src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      },
    },
  }),
)
