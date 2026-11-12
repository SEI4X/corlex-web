import { staticLabel } from './autocapture/types'
import { MAX_CONTEXT, truncateBytes } from '#core'
import { SDK_VERSION } from './version'
import type { Properties, WireEvent } from './types'

export const SDK_NAME = 'corlex-web'

/**
 * Ingest keeps only a fixed set of context fields (platform, locale, sdk, …);
 * the user agent comes from the request header and the IP from the connection.
 * Everything page-related therefore travels as event properties.
 */
export function baseContext(): WireEvent['context'] {
  const context: WireEvent['context'] = {
    platform: 'web',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  }
  const locale = globalThis.navigator?.language
  if (locale) context.locale = truncateBytes(locale, MAX_CONTEXT)
  return context
}

/** Only the page origin; route identity requires an explicit fixed instrumentation label. */
export function currentOrigin(): string {
  return location.origin
}

/** Page properties attached to every event; the caller's own keys win. */
export function pageProperties(): Properties {
  const label =
    staticLabel(document.documentElement, 'data-corlex-page') ??
    staticLabel(document.body, 'data-corlex-page')
  return { page_origin: currentOrigin(), ...(label ? { page_path: label } : {}) }
}

/** Screen and viewport sizes; sent with page_view only, they do not change per event. */
export function screenProperties(): Properties {
  return {
    screen_width: screen.width,
    screen_height: screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  }
}
