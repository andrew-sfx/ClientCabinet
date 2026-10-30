import { createContext } from 'react'
import type { CabinetSection } from './section-types'

export const SectionRegistry = createContext<CabinetSection[]>([])
