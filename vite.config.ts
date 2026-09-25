import { fileURLToPath, URL } from 'node:url'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages のプロジェクトサイト（https://fumobox.github.io/NetworkStudy/）配下で配信する
  base: '/NetworkStudy/',
  // MDX は JSX に変換してから React のプラグインに渡すため、先に実行する
  plugins: [
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) },
    // MDX を編集したときも Fast Refresh が効くように、.mdx も対象にする
    react({ include: /\.(mdx|[tj]sx?)$/ }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
