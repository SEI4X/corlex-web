import type { KeyValueStore, PlatformHost } from '#core'
import { startClicks } from './clicks'
import { startErrors } from './errors'
import { startForms } from './forms'
import { startPageViews } from './pageview'
import type { AutocaptureOptions } from '../types'

/** `true`/undefined turns everything on, `false` everything off, an object picks parts. */
export function resolveAutocapture(
  option: boolean | AutocaptureOptions | undefined,
): Required<AutocaptureOptions> {
  const pick = (key: keyof AutocaptureOptions): boolean =>
    typeof option === 'object' ? option[key] !== false : option !== false
  return {
    pageViews: pick('pageViews'),
    clicks: pick('clicks'),
    forms: pick('forms'),
    errors: pick('errors'),
  }
}

/** Starts the enabled collectors; the returned function stops them all. */
export function startAutocapture(
  options: Required<AutocaptureOptions> & { captureErrorMessages?: boolean },
  host: PlatformHost,
  session: KeyValueStore,
): () => void {
  const track = host.track
  const stops: (() => void)[] = []
  if (options.errors) stops.push(startErrors(host, session, options.captureErrorMessages === true))
  if (options.clicks) stops.push(startClicks(track))
  if (options.forms) stops.push(startForms(track))
  if (options.pageViews) stops.push(startPageViews(track))
  return () => stops.forEach((stop) => stop())
}
