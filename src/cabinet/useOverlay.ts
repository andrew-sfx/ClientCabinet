import { useEffect, useRef } from 'react'
import { focusStops, isolateModal } from './modal'

export function useOverlay(close: () => void, returnTo: HTMLElement | null, modalOnMobile = true, provided?: React.RefObject<HTMLDivElement | null>) {
  const fallback = useRef<HTMLDivElement>(null)
  const element = provided ?? fallback
  useEffect(() => {
    const node = element.current
    const visibleStops = () => node ? focusStops(node) : []
    const media = window.matchMedia('(max-width: 600px)')
    let restore: (() => void) | undefined
    const updateModal = () => {
      restore?.(); restore = undefined
      if (node && modalOnMobile && media.matches) { restore = isolateModal(node); node.setAttribute('aria-modal', 'true') }
      else node?.removeAttribute('aria-modal')
    }
    updateModal()
    media.addEventListener('change', updateModal)
    visibleStops()[0]?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'Tab' && modalOnMobile && window.matchMedia('(max-width: 600px)').matches && node) {
        const stops = visibleStops()
        const first = stops[0], last = stops.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); media.removeEventListener('change', updateModal); restore?.(); if (returnTo?.isConnected) returnTo.focus() }
  }, [close, returnTo, modalOnMobile, element])
  return element
}
