import { useContext } from 'react'
import type { ReactNode } from 'react'
import { SectionRegistry } from './section-context'
import { RouteLink, useRoute } from './router'
import { Soon } from './shared'
import { MoneySoon } from './MoneySoon'

export function SectionEntry({ id, children, className = '', label, money = false, active = false }: {
  id: string; children: ReactNode; className?: string; label?: string; money?: boolean; active?: boolean
}) {
  const registry = useContext(SectionRegistry)
  const path = useRoute()
  const section = registry.find(section => section.id === id)
  if (!section?.component) return money
    ? <MoneySoon className={className} label={label!}>{children}</MoneySoon>
    : <Soon className={className} label={label}>{children}</Soon>
  const current = active && path === section.path
  return <RouteLink href={section.path} className={className + (current ? ' on' : '')} aria-label={label} aria-current={current ? 'page' : undefined}>{children}</RouteLink>
}
