import { useCallback, useEffect, useRef } from 'react'

// Keep the existing overlay mounted until its CSS exit finishes. Desktop menus
// close immediately; the operation panel also releases its layout width.
export function useAnimatedClose<T extends HTMLElement>(close: () => void, panel = false) {
  const element = useRef<T>(null)
  const pending = useRef(false)
  const requestClose = useCallback(() => {
    if (pending.current) return
    const node = element.current
    if (!node || (!panel && !matchMedia('(max-width: 600px)').matches)) { close(); return }
    pending.current = true
    node.classList.add('is-closing')
    const shell = panel ? node.closest('.home-shell') : null
    shell?.classList.add('home-panel-closing')
    const animations = [...node.getAnimations({ subtree: true }), ...(shell?.querySelector('.home-panel-slot')?.getAnimations() ?? [])]
    void Promise.allSettled(animations.filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)).then(() => {
      if (!node.isConnected) return
      shell?.classList.remove('home-panel-closing')
      close()
    })
  }, [element, close, panel])
  useEffect(() => {
    const node = element.current
    node?.addEventListener('overlay-close', requestClose)
    const shell = panel ? node?.closest('.home-shell') : null
    return () => {
      node?.removeEventListener('overlay-close', requestClose)
      shell?.classList.remove('home-panel-closing')
    }
  }, [element, requestClose, panel])
  return { element, requestClose }
}
