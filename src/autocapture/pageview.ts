import { currentOrigin, screenProperties } from '../context'
import { safeOrigin, type Track } from './types'

type HistoryMethod = 'pushState' | 'replaceState'

/** Replaces a History method; the returned function puts the original back. */
function patch(method: HistoryMethod, after: () => void): () => void {
  const original = history[method]
  const patched = function (this: History, ...args: Parameters<History[HistoryMethod]>) {
    const result = original.apply(this, args)
    after()
    return result
  }
  history[method] = patched
  return () => {
    if (history[method] === patched) history[method] = original
  }
}

/**
 * `page_view` on load and on every SPA navigation (pushState, replaceState,
 * popstate). The same path and query is reported once in a row, so frameworks
 * that call replaceState on every render do not flood the queue.
 */
export function startPageViews(track: Track): () => void {
  let last: string | undefined
  let previousUrl: string | undefined
  const fire = () => {
    const key = `${location.pathname}${location.search}`
    if (key === last) return
    last = key
    const referrer = previousUrl ?? (document.referrer ? safeOrigin(document.referrer) : '')
    previousUrl = currentOrigin()
    track('page_view', { ...screenProperties(), ...(referrer ? { referrer } : {}) })
  }
  // Read explicit route labels after the framework finishes navigation.
  const later = () => void setTimeout(fire, 0)
  const restore = [patch('pushState', later), patch('replaceState', later)]
  addEventListener('popstate', later)
  fire()
  return () => {
    restore.forEach((undo) => undo())
    removeEventListener('popstate', later)
  }
}
