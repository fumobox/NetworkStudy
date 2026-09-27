import { lazy } from 'react'
import { IPV6_ADDRESS_META } from '../themeMeta'
import type { CustomThemeModule } from '../types'
import { ipv6AddressQuiz } from './quiz'

export const ipv6AddressTheme: CustomThemeModule = {
  kind: 'custom',
  meta: IPV6_ADDRESS_META,
  quiz: ipv6AddressQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  body: lazy(() => import('./Ipv6Address').then((module) => ({ default: module.Ipv6Address }))),
}
