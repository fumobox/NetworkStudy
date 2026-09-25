import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AppRoutes } from '@/app/AppRoutes'
import { TooltipProvider } from '@/components/ui/tooltip'
import '@/index.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/*
        バンドルを小さくするため、m コンポーネントとアニメーション機能（domAnimation）だけを使う（strict で motion.* の混入を防ぐ）。
        機能を動的 import にすると、読み込み前にマウントされた要素の初回アニメーションが実行されず、
        最新のメッセージが開始状態（線の長さ 0・透明）のまま残るので、同期的に読み込む
      */}
      <LazyMotion features={domAnimation} strict>
        {/* Motion の既定は reducedMotion="never" なので、OS の「視差効果を減らす」設定に従わせる */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <AppRoutes />
          </TooltipProvider>
        </MotionConfig>
      </LazyMotion>
    </BrowserRouter>
  </StrictMode>,
)
