import { useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, RefObject } from 'react'

// Keep layout and native wheel/keyboard/touch scrolling in the browser. Only the
// visual thumb is custom; it never enters the tab order or replaces list semantics.
export function OverlayScroll({ children, className = '', viewportClassName = '', viewportRef, ...props }: HTMLAttributes<HTMLDivElement> & {
  viewportClassName?: string; viewportRef?: RefObject<HTMLDivElement | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const localViewport = useRef<HTMLDivElement>(null)
  const viewport = viewportRef ?? localViewport
  const content = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const area = host.current!, scroller = viewport.current!, handle = thumb.current!
    let timer: ReturnType<typeof setTimeout> | undefined
    let drag: { id: number; y: number; top: number } | undefined
    let travel = 0, range = 0
    const measure = () => {
      range = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const height = Math.min(scroller.clientHeight, Math.max(24, scroller.clientHeight ** 2 / scroller.scrollHeight)) || 0
      travel = Math.max(0, scroller.clientHeight - height)
      area.dataset.overflow = String(range > 1)
      area.dataset.scrolled = String(scroller.scrollTop > 0)
      handle.style.height = `${height}px`
      handle.style.transform = `translateY(${range ? scroller.scrollTop / range * travel : 0}px)`
    }
    const stopDrag = () => {
      if (drag && handle.hasPointerCapture(drag.id)) handle.releasePointerCapture(drag.id)
      drag = undefined
      delete area.dataset.dragging
    }
    const scroll = () => {
      measure()
      area.dataset.scrolling = 'true'
      clearTimeout(timer)
      timer = setTimeout(() => { delete area.dataset.scrolling }, 1000)
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === 'touch' || range <= 1) return
      event.preventDefault()
      drag = { id: event.pointerId, y: event.clientY, top: scroller.scrollTop }
      area.dataset.dragging = 'true'
      handle.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.id && travel > 0) scroller.scrollTop = drag.top + (event.clientY - drag.y) * range / travel
    }
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    observer.observe(content.current!)
    scroller.addEventListener('scroll', scroll, { passive: true })
    handle.addEventListener('pointerdown', down)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stopDrag)
    handle.addEventListener('pointercancel', stopDrag)
    handle.addEventListener('lostpointercapture', stopDrag)
    measure()
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      scroller.removeEventListener('scroll', scroll)
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stopDrag)
      handle.removeEventListener('pointercancel', stopDrag)
      handle.removeEventListener('lostpointercapture', stopDrag)
      stopDrag()
    }
  }, [viewport])
  return <div ref={host} className={'overlay-scroll ' + className}>
    <div {...props} ref={viewport} className={'overlay-scroll-viewport ' + viewportClassName}><div ref={content} className="overlay-scroll-content">{children}</div></div>
    <div ref={thumb} className="overlay-scroll-thumb" aria-hidden="true" />
  </div>
}
