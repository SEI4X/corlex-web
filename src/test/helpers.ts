import { PRIVACY_RECORD, writePrivacy } from '../binding/privacy'
import { vi } from 'vitest'
import { Corlex } from '../client'
import { MAX_EVENTS_PER_BATCH, rejectionReason } from '#core/test-protocol'
import type { InitOptions, WireEvent } from '../types'

export const KEY = `ck_live_${'a'.repeat(43)}`
export const ENDPOINT = 'https://ingest.test'

export interface Call {
  url: string
  headers: Record<string, string>
  keepalive: boolean | undefined
  events: WireEvent[]
}

type Reply = number | { status: number; retryAfter?: string } | 'network-error'

/**
 * Replaces fetch. Each reply is used once, in order; after that every request
 * gets 202. Every request body is checked against the ingest protocol.
 */
export function mockFetch(replies: Reply[] = []) {
  const calls: Call[] = []
  const queue = [...replies]
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    // Remote Config downloads (task 39) are not event batches: answered "no config yet", not counted.
    if (String(url).includes('/v1/config/')) {
      return new Response('{"error":"no_config"}', { status: 404 })
    }
    const body = JSON.parse(String(init?.body)) as { events: WireEvent[] }
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      keepalive: init?.keepalive,
      events: body.events,
    })
    const reply = queue.shift() ?? 202
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    const { status, retryAfter } = typeof reply === 'number' ? { status: reply } : reply
    const headers = retryAfter ? { 'Retry-After': retryAfter } : undefined
    return new Response('{}', headers ? { status, headers } : { status })
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn, queue }
}

/** Fails the test when a sent batch breaks a rule the Go ingest enforces. */
export function expectProtocolValid(calls: Call[]): void {
  for (const call of calls) {
    if (call.events.length > MAX_EVENTS_PER_BATCH) throw new Error('batch over 500 events')
    for (const event of call.events) {
      const reason = rejectionReason(event as unknown as Record<string, unknown>)
      if (reason !== '') throw new Error(`ingest would reject "${event.name}": ${reason}`)
    }
  }
}

const instances: Corlex[] = []

export function startSdk(options: Partial<InitOptions> = {}): Corlex {
  const sdk = new Corlex()
  instances.push(sdk)
  sdk.init({ key: KEY, endpoint: ENDPOINT, autocapture: false, ...options })
  return sdk
}

export function cleanup(): void {
  instances.splice(0).forEach((sdk) => sdk.destroy())
  localStorage.clear()
  sessionStorage.clear()
  document.cookie.split('; ').forEach((c) => {
    document.cookie = `${c.split('=')[0]}=; max-age=0; path=/`
  })
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Restore the process privacy fault latch through a successful SDK privacy write.
  writePrivacy('pending')
  localStorage.removeItem(PRIVACY_RECORD)
}

export const names = (calls: Call[]): string[] => calls.flatMap((c) => c.events.map((e) => e.name))

/** Inspect persisted SDK data without assuming an unbound singleton physical key. */
export function sdkStored(key: string, area: Storage = localStorage): string | null {
  const physical = Array.from({ length: area.length }, (_, i) => area.key(i)).find(
    (name) => name?.startsWith('corlex_scope_v1:') && name.endsWith(':' + key),
  )
  return physical ? area.getItem(physical) : null
}
