import type { ComponentType, Dispatch, ReactNode, SetStateAction } from 'react'
import type { AccountSummary } from '../auth/api'
import type { Session } from '../auth/session'
import type { HomeApi } from './api'

export type ShellPanel = { content: ReactNode; close: () => void } | null
export type SectionProps = {
  session: Session
  summary: AccountSummary
  api: HomeApi
  onSessionLost: () => void
  onLogout: () => void
  setPanel: Dispatch<SetStateAction<ShellPanel>>
  closeMenu: () => void
}
export type CabinetSection = { id: string; path: string; title: string; component?: ComponentType<SectionProps>; standalone?: boolean }
