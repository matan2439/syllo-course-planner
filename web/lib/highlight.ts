import { HIGHLIGHT_EVENT } from '../../shared/planner/ui-highlight'

/**
 * Point at an element anywhere on the site: scroll it into view and make it glow for a moment.
 *
 * Any element opts in with `data-highlight-id="<target>"` (e.g. `course:0509-1234`, `filter:grade`,
 * `button:planning-tools`). Nothing is wired per screen: before looking for the element, a cancelable
 * `syllo:highlight` event is fired on `window` with `{ target }`, so whoever owns a hidden element
 * (a closed panel, another tab) can bring it on screen first.
 *
 * Returns whether the element was found.
 */
export const HIGHLIGHT_MS = 2600

const escapeTarget = (target: string) => target.replace(/["\\]/g, '\\$&')

function find(target: string): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>(`[data-highlight-id="${escapeTarget(target)}"]`)]
  // The same course can be drawn twice (e.g. an annual course); prefer one that is actually laid out.
  return matches.find((element) => element.getClientRects().length > 0) ?? matches[0] ?? null
}

function flash(element: HTMLElement) {
  if (element instanceof HTMLDetailsElement) element.open = true // a collapsed section shows what was pointed at
  element.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'center' })
  element.removeAttribute('data-highlighted')
  void element.offsetWidth // restart the animation when the same element is highlighted twice in a row
  element.setAttribute('data-highlighted', 'true')
  window.setTimeout(() => element.removeAttribute('data-highlighted'), HIGHLIGHT_MS)
}

export function highlightElement(target: string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail: { target } }))
  // Owners reveal the element in a state update; look for it once that has painted.
  return new Promise((resolve) => {
    let tries = 0
    const attempt = () => {
      const element = find(target)
      if (element && element.getClientRects().length > 0) { flash(element); resolve(true); return }
      if (++tries >= 8) { resolve(false); return }
      window.setTimeout(attempt, 80)
    }
    window.setTimeout(attempt, 0)
  })
}
