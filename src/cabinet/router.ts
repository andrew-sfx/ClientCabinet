import { createElement, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'

const routeEvent = 'cabinet:navigate'
const pathname = () => window.location.pathname
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(routeEvent, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(routeEvent, listener)
  }
}

export function navigate(path: string, replace = false) {
  const url = new URL(path, window.location.href)
  if (url.origin !== window.location.origin) throw new Error('Cabinet routes must use the same origin')
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  window.dispatchEvent(new Event(routeEvent))
}

export function useRoute() { return useSyncExternalStore(subscribe, pathname) }

export function RouteLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== '_self') || props.download !== undefined) return
    if (new URL(href, window.location.href).origin !== window.location.origin) return
    event.preventDefault()
    navigate(href)
  }
  return createElement('a', { ...props, href, onClick: click })
}
