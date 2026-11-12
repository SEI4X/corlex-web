import { vi } from 'vitest'
import type { WireEvent } from '../types'

export const CONFIG_ENDPOINT = 'https://config.test'

export interface ConfigCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

export type Experiments = {
  k: string
  s: string
  p?: string
  v: { n: string; b: number; v: unknown }[]
}[]
type Params = { k: string; t: string; v: unknown; r: number; o?: Record<string, unknown> }[]

/**
 * A stand-in for edge-config: serves the current document with a strong ETag and answers 304 to a
 * matching If-None-Match, like the real service. `publish` is what «Опубликовать» does.
 */
export function configServer(initial?: Params, experiments?: Experiments) {
  let version = 0
  let doc: string | undefined
  let etag = ''
  const calls: ConfigCall[] = []
  /** Events the SDK sent to ingest. */
  const events: WireEvent[] = []
  const publish = (params: Params, experiments?: Experiments): void => {
    version += 1
    etag = `"v${version}-test"`
    doc = JSON.stringify({ version, etag, params, ...(experiments ? { experiments } : {}) })
  }
  if (initial) publish(initial, experiments)
  let mode: 'ok' | 'down' | 'garbage' = 'ok'

  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!String(url).includes('/v1/config/')) {
      const batch = JSON.parse(String(init?.body ?? '{}')) as { events?: WireEvent[] }
      events.push(...(batch.events ?? []))
      return new Response('{}', { status: 202 })
    }
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: init?.body,
    })
    if (mode === 'down') throw new TypeError('Failed to fetch')
    if (mode === 'garbage') return new Response('<html>', { status: 200 })
    if (doc === undefined) return new Response('{"error":"no_config"}', { status: 404 })
    if ((init?.headers as Record<string, string>)['If-None-Match'] === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } })
    }
    return new Response(doc, { status: 200, headers: { ETag: etag } })
  })
  vi.stubGlobal('fetch', fn)
  return {
    calls,
    events,
    fn,
    publish,
    breakIt: (next: 'ok' | 'down' | 'garbage') => (mode = next),
    get version() {
      return version
    },
  }
}

export const bool = (
  k: string,
  v: boolean,
  { r = 10000, o }: { r?: number; o?: Record<string, unknown> } = {},
) => ({ k, t: 'bool', v, r, ...(o ? { o } : {}) })
