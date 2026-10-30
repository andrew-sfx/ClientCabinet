// Inert siblings along the ancestor chain, preserving existing inert/scroll state.
export function isolateModal(node: HTMLElement) {
  const siblings: [HTMLElement, boolean][] = []
  for (let child: HTMLElement = node; child.parentElement; child = child.parentElement) {
    for (const sibling of child.parentElement.children) {
      if (sibling !== child && sibling instanceof HTMLElement) {
        siblings.push([sibling, sibling.inert]); sibling.inert = true
      }
    }
  }
  const overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  return () => {
    for (const [element, inert] of siblings) element.inert = inert
    document.body.style.overflow = overflow
  }
}

export function focusStops(node: HTMLElement) {
  return [...node.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0)
}
