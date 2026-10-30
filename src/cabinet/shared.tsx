import type { ReactNode } from 'react'

// No event handlers or href: these controls only advertise a future destination.
export function Soon({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <button type="button" disabled aria-disabled="true" title="Скоро" aria-label={label} className={'home-soon ' + className}>{children}</button>
}
export function Brand() { return <span className="home-logo" aria-label="ClientCabinet">C</span> }
