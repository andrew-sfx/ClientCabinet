import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

// Dropdowns are content-sized up to the actual viewport bottom, including after
// a resize, font/layout change or page scroll. Mobile sheets use their own inset.
export function useScrollCardLimit(element: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const card = element.current!
    const measure = () => card.style.setProperty('--scroll-card-top', `${Math.max(0, card.getBoundingClientRect().top)}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    if (card.parentElement) observer.observe(card.parentElement)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [element])
}
