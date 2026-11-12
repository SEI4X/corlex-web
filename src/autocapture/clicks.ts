import { isIgnored, safeOrigin, staticLabel, type Track } from './types'
import type { Properties } from '../types'

const CLICKABLE = 'button, a, [role="button"], input[type="submit"], input[type="button"]'
/** Read explicit fixed instrumentation labels; never infer identity from dynamic DOM text/ids. */
function describe(el: Element): Properties {
  const props: Properties = { tag: el.tagName.toLowerCase() }
  const action = staticLabel(el, 'data-corlex-action')
  if (action) props['action'] = action
  const href = el.tagName === 'A' ? el.getAttribute('href') : null
  const origin = href ? safeOrigin(href) : ''
  if (origin) props['href_origin'] = origin
  return props
}
export function startClicks(track: Track): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest(CLICKABLE) : null
    if (target && !isIgnored(target)) track('click', describe(target))
  }
  addEventListener('click', onClick, true)
  return () => removeEventListener('click', onClick, true)
}
