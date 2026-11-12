import { sdkStored } from './helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Corlex } from '../client'
import { QUEUE_KEY } from '#core'
import { cleanup, ENDPOINT, expectProtocolValid, KEY, mockFetch, names, startSdk } from './helpers'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
})

describe('batching', () => {
  it('sends nothing until the interval passes, then one batch', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('a')
    sdk.track('b')
    await vi.advanceTimersByTimeAsync(4999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(names(calls)).toEqual(['a', 'b'])
    expect(calls).toHaveLength(1)
    expectProtocolValid(calls)
  })

  it('sends as soon as a batch is full', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ batchSize: 3 })
    sdk.track('a')
    sdk.track('b')
    sdk.track('c')
    await vi.advanceTimersByTimeAsync(0)
    expect(names(calls)).toEqual(['a', 'b', 'c'])
  })

  it('splits a backlog into batches of the configured size', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ batchSize: 2 })
    for (const n of ['a', 'b', 'c', 'd', 'e']) sdk.track(n)
    await sdk.flush()
    expect(calls.map((c) => c.events.length)).toEqual([2, 2, 1])
  })

  it('flush() sends right away and resolves after delivery', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    expect(names(calls)).toEqual(['a'])
  })

  it('flushes when the page is hidden', async () => {
    const { calls } = mockFetch()
    startSdk().track('bye')
    dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(names(calls)).toEqual(['bye'])
  })

  it('authenticates with a header and keeps the key out of the URL', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    const [call] = calls
    expect(call?.url).toBe(`${ENDPOINT}/v1/batch`)
    expect(call?.url).not.toContain(KEY)
    expect(call?.headers['X-Corlex-Key']).toBe(KEY)
    // keepalive is for the unload flush only: see keepalive-burst.test.ts
    expect(call?.keepalive).toBeUndefined()
  })

  it('the pagehide flush uses keepalive, still with the key in a header', async () => {
    const { calls } = mockFetch()
    startSdk().track('bye')
    dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[0]?.keepalive).toBe(true)
    expect(calls[0]?.url).not.toContain(KEY)
    expect(calls[0]?.headers['X-Corlex-Key']).toBe(KEY)
  })

  it('drops events with names the protocol forbids and warns once', async () => {
    const { calls } = mockFetch()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sdk = startSdk()
    sdk.track('Button Clicked')
    sdk.track('Button Clicked')
    sdk.track('ok_name')
    await sdk.flush()
    expect(names(calls)).toEqual(['ok_name'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('shapes properties to the limits and drops what JSON cannot hold', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    const deep = { a: { b: { c: { d: 1 } } } }
    sdk.track('big', { long: 'я'.repeat(2000), fn: () => 1, nan: NaN, deep, list: [1, 2] })
    await sdk.flush()
    expectProtocolValid(calls)
    const props = calls[0]?.events[0]?.properties
    expect(props).not.toHaveProperty('fn')
    expect(props?.['nan']).toBeNull()
    expect(props).not.toHaveProperty('deep.a.b.c')
  })
})

describe('retry', () => {
  it('retries a 503 with the same event ids after an exponential backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const { calls } = mockFetch([503, 503])
    const sdk = startSdk()
    sdk.track('a')
    sdk.track('b')
    await sdk.flush()
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(3)
    const ids = calls.map((c) => c.events.map((e) => e.event_id))
    expect(ids[1]).toEqual(ids[0])
    expect(ids[2]).toEqual(ids[0])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(3)
  })

  it('adds jitter but never waits less than half of the step', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { calls } = mockFetch(['network-error'])
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    await vi.advanceTimersByTimeAsync(499)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
  })

  it('honors Retry-After on 429', async () => {
    const { calls } = mockFetch([{ status: 429, retryAfter: '30' }])
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
  })

  it('does not send newly tracked events while backing off', async () => {
    const { calls } = mockFetch([{ status: 503, retryAfter: '10' }])
    const sdk = startSdk({ batchSize: 2 })
    sdk.track('a')
    await sdk.flush()
    sdk.track('b')
    sdk.track('c')
    await vi.advanceTimersByTimeAsync(9000)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls[1]?.events.map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('drops a batch the server rejects with 400 and keeps later events', async () => {
    const { calls } = mockFetch([400])
    const sdk = startSdk({ debug: true })
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    sdk.track('bad')
    await sdk.flush()
    sdk.track('good')
    await sdk.flush()
    expect(names(calls)).toEqual(['bad', 'good'])
    expect(sdkStored(QUEUE_KEY)).toBe('[]')
  })

  it('halves a batch the server finds too large (413)', async () => {
    const { calls } = mockFetch([413])
    const sdk = startSdk()
    for (const n of ['a', 'b', 'c', 'd']) sdk.track(n)
    await sdk.flush()
    expect(calls.map((c) => c.events.length)).toEqual([4, 2, 2])
  })

  it('stops sending after 401, warns once and forgets the queue', async () => {
    const { calls } = mockFetch([401])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    sdk.track('b')
    await sdk.flush()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stops sending after 403 too', async () => {
    const { calls } = mockFetch([403])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    sdk.track('b')
    await sdk.flush()
    expect(calls).toHaveLength(1)
  })
})

describe('persistence', () => {
  it('keeps unsent events across a reload and delivers them with the same ids', async () => {
    const first = mockFetch()
    startSdk().track('before_reload')
    const stored = JSON.parse(sdkStored(QUEUE_KEY) ?? '[]') as { event_id: string }[]
    expect(stored).toHaveLength(1)
    expect(first.calls).toHaveLength(0)

    const second = mockFetch()
    const reloaded = startSdk()
    await reloaded.flush()
    expect(names(second.calls)).toEqual(['before_reload'])
    expect(second.calls[0]?.events[0]?.event_id).toBe(stored[0]?.event_id)
  })

  it('keeps events whose delivery failed, until the server acknowledges them', async () => {
    mockFetch(['network-error'])
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    expect(JSON.parse(sdkStored(QUEUE_KEY) ?? '[]')).toHaveLength(1)
  })

  it('works in memory when storage throws', async () => {
    const { calls } = mockFetch()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const sdk = new Corlex()
    sdk.init({ key: KEY, endpoint: ENDPOINT, autocapture: false })
    sdk.optIn()
    sdk.track('a')
    await sdk.flush()
    expect(names(calls)).toEqual(['a'])
    sdk.destroy()
  })
})
