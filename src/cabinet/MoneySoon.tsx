import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// These handlers only explain availability; they never perform a money action.
export function MoneySoon({ children, className, label }: { children: ReactNode; className: string; label: string }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function hide() { clearTimeout(timer.current); setVisible(false) }
  function show() {
    clearTimeout(timer.current)
    setVisible(true)
    timer.current = setTimeout(() => setVisible(false), 2000)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return <button type="button" aria-disabled="true" aria-label={label} aria-describedby={id} className={'home-soon ' + className}
    onClick={show} onFocus={show} onBlur={hide} onPointerLeave={hide}
    onPointerEnter={event => { if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) show() }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show() } }}>
    {children}<span id={id} role="tooltip" className="home-soon-tooltip" data-visible={visible}>Скоро</span>
  </button>
}
