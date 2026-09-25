import { LazyMotion, MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AppRoutes } from '@/app/AppRoutes'
import { TooltipProvider } from '@/components/ui/tooltip'
import '@/index.css'

const loadMotionFeatures = () => import('@/app/motionFeatures').then((module) => module.default)

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* バンドルを小さくするため、m コンポーネントとアニメーション機能だけを遅延読み込みで使う（strict で motion.* の混入を防ぐ） */}
      <LazyMotion features={loadMotionFeatures} strict>
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
