import { MotionConfig } from 'motion/react'
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
      {/* Motion の既定は reducedMotion="never" なので、OS の「視差効果を減らす」設定に従わせる */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <AppRoutes />
        </TooltipProvider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
)
