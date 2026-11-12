import { byteLength, truncateBytes } from '#core'
import { safeOrigin } from './autocapture/types'
import type { KeyValueStore } from '#core'
import type { Properties } from './types'

const SESSION_KEY = 'corlex_session'
/** The only query parameters kept by default: campaign tags and ad click ids. */
export const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'yclid',
]

function paramsFromUrl(search: string, allowed: readonly string[]): Properties {
  const params = new URLSearchParams(search)
  const out: Properties = {}
  for (const key of allowed) {
    const value = params.get(key)
    if (value) out[key] = truncateBytes(value, 1024)
  }
  return out
}

function externalReferrer(): string | undefined {
  const ref = document.referrer
  if (!ref) return undefined
  try {
    const url = new URL(ref)
    return url.host === location.host ? undefined : url.origin
  } catch {
    return undefined
  }
}

function stored(allowed: readonly string[], store: KeyValueStore): Properties {
  try {
    const raw = store.get(SESSION_KEY) ?? '{}'
    if (raw.length > 1024 * 1024 || byteLength(raw) > 1024 * 1024) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          typeof value === 'string' && (allowed.includes(key) || key === 'initial_referrer'),
      ),
    )
  } catch {
    return {}
  }
}

/**
 * Allowlisted query parameters (campaign tags, ad click ids and the names the
 * site owner listed in `captureQueryParams`) and the external referrer of the
 * session. Nothing else from the query string is ever read. Tags in the current URL
 * replace stored ones (a new campaign touch); otherwise the stored session
 * survives page loads. The referrer is the one the session started with.
 * Returns properties to attach to every event.
 */
export function collectSession(
  extraParams: readonly string[] | undefined,
  store: KeyValueStore,
): Properties {
  const allowed = [...CAMPAIGN_PARAMS, ...(extraParams ?? [])]
  const previous = stored(allowed, store)
  const fresh = paramsFromUrl(location.search, allowed)
  const next: Properties = Object.keys(fresh).length > 0 ? fresh : { ...previous }
  const referrer = previous['initial_referrer'] ?? externalReferrer()
  if (typeof referrer === 'string') {
    const origin = safeOrigin(referrer)
    if (origin) next['initial_referrer'] = origin
  }
  return next
}

export function persistSession(props: Properties, store: KeyValueStore): void {
  store.set(SESSION_KEY, JSON.stringify(props))
}

export function clearSession(store: KeyValueStore): void {
  store.remove(SESSION_KEY)
}
