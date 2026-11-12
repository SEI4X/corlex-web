import { sdkStored } from './helpers'
import { QUEUE_KEY } from '#core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, startSdk } from './helpers'
import type { WireEvent } from '../types'

afterEach(cleanup)

/** Chromium refuses a keepalive request when the in-flight keepalive bodies would pass 64 KiB. */
const QUOTA = 64 * 1024
/** The quota is given back a little after the response, not at once. */
const RELEASE_MS = 20

interface Server {
  received: WireEvent[]
  keepaliveRequests: number
  refused: number
  maxKeepaliveBody: number
}

function chromiumLikeFetch(): Server {
  const server: Server = { received: [], keepaliveRequests: 0, refused: 0, maxKeepaliveBody: 0 }
  let inFlight = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/v1/config/')) return new Response('{}', { status: 404 })
      const body = String(init?.body)
      const size = new TextEncoder().encode(body).length
      if (init?.keepalive === true) {
        server.keepaliveRequests += 1
        server.maxKeepaliveBody = Math.max(server.maxKeepaliveBody, size)
        if (inFlight + size > QUOTA) {
          server.refused += 1
          throw new TypeError('Failed to fetch') // what Chromium does over the quota
        }
        inFlight += size
        setTimeout(() => (inFlight -= size), RELEASE_MS)
      }
      await new Promise((resolve) => setTimeout(resolve, 2))
      server.received.push(...(JSON.parse(body) as { events: WireEvent[] }).events)
      return new Response('{}', { status: 202 })
    }),
  )
  return server
}

const track = (sdk: ReturnType<typeof startSdk>, count: number): void => {
  for (let i = 0; i < count; i += 1)
    sdk.track('burst', { i, text: 'x'.repeat(1000), more: 'y'.repeat(1000) })
}

const queued = (): number => (JSON.parse(sdkStored(QUEUE_KEY) ?? '[]') as unknown[]).length

describe('a tight burst of batches against the keepalive quota', () => {
  it('flush() resolves only when the queue has drained, every event delivered once', async () => {
    const server = chromiumLikeFetch()
    const sdk = startSdk({ batchSize: 20 })
    track(sdk, 120)
    await sdk.flush()
    expect(queued()).toBe(0)
    expect(server.received).toHaveLength(120)
    expect(new Set(server.received.map((e) => e.event_id)).size).toBe(120)
  })

  it('a normal flush does not use keepalive at all', async () => {
    const server = chromiumLikeFetch()
    const sdk = startSdk({ batchSize: 20 })
    track(sdk, 60)
    await sdk.flush()
    expect(server.keepaliveRequests).toBe(0)
  })

  it('the unload flush uses keepalive only within the quota, in chunks, and drains', async () => {
    const server = chromiumLikeFetch()
    const sdk = startSdk({ batchSize: 500 })
    track(sdk, 100)
    dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(queued()).toBe(0), { timeout: 3000 })
    expect(server.keepaliveRequests).toBeGreaterThan(1)
    expect(server.maxKeepaliveBody).toBeLessThanOrEqual(60_000)
    expect(new Set(server.received.map((e) => e.event_id)).size).toBe(100)
  })

  it('falls back to a plain request when the browser still refuses keepalive', async () => {
    const server = chromiumLikeFetch()
    const sdk = startSdk({ batchSize: 500 })
    track(sdk, 100)
    dispatchEvent(new Event('pagehide'))
    await sdk.flush()
    expect(queued()).toBe(0)
    expect(server.received).toHaveLength(100)
  })
})
