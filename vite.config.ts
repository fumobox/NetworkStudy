import { fileURLToPath, URL } from 'node:url'
import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages のプロジェクトサイト（https://fumobox.github.io/NetworkStudy/）配下で配信する
  base: '/NetworkStudy/',
  // MDX は JSX に変換してから React のプラグインに渡すため、先に実行する
  plugins: [{ enforce: 'pre', ...mdx() }, react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
