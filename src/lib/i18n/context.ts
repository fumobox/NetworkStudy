import { createContext } from 'react'
import type { Locale } from './locale'

export const LocaleContext = createContext<Locale | null>(null)
