import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, mockFetch, names, startSdk } from './helpers'
import type { Corlex } from '../client'

// Task 42, acceptance: an SDK without consent makes NO network request. Not a batch, not a
// flag or config fetch, not a beacon, not an XHR, not an image ping, not a WebSocket. Every
// channel a browser has is watched, and the SDK is driven through everything it can do.

interface Watch {
  fetch: ReturnType<typeof mockFetch>
  xhr: ReturnType<typeof vi.spyOn>
  beacon: ReturnType<typeof vi.fn>
  websocket: ReturnType<typeof vi.fn>
  /** Number of requests seen on any channel. */
  count: () => number
}

function watchNetwork(): Watch {
  const fetch = mockFetch()
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined)
  const beacon = vi.fn(() => true)
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
  const websocket = vi.fn()
  vi.stubGlobal('WebSocket', websocket)
  return {
    fetch,
    xhr,
    beacon,
    websocket,
    count: () =>
      fetch.fn.mock.calls.length +
      xhr.mock.calls.length +
      beacon.mock.calls.length +
      websocket.mock.calls.length,
  }
}

/** Everything a page and an app can ask of the SDK, then time passing and the page closing. */
async function useEverything(sdk: Corlex): Promise<void> {
  sdk.track('a')
  sdk.identify('u_1', { plan: 'pro' })
  sdk.setUserProperties({ plan: 'pro' })
  sdk.track('b', { x: 1 })
  expect(sdk.flag('new_paywall', false)).toBe(false)
  history.pushState(null, '', '/pricing')
  document.body.innerHTML = '<form id="f"><button id="b" type="button">Buy</button></form>'
  document.getElementById('b')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  document
    .getElementById('f')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }))
  await sdk.flush()
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  window.dispatchEvent(new Event('pagehide'))
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  sdk.reset()
  await sdk.flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/')
  Reflect.deleteProperty(navigator, 'doNotTrack')
  Reflect.deleteProperty(navigator, 'globalPrivacyControl')
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'sendBeacon')
  Reflect.deleteProperty(document, 'visibilityState')
  vi.restoreAllMocks()
  cleanup()
})

describe('no consent, no network', () => {
  it('makes no request while consent is pending: init, track, identify, autocapture, timers, page close', async () => {
    const watch = watchNetwork()
    const sdk = startSdk({ consent: 'pending', autocapture: true })
    await useEverything(sdk)
    expect(watch.count()).toBe(0)
    expect(watch.fetch.fn).not.toHaveBeenCalled()
  })

  it('also makes none with the smallest batch and the shortest timer', async () => {
    const watch = watchNetwork()
    const sdk = startSdk({
      consent: 'pending',
      autocapture: true,
      batchSize: 1,
      flushIntervalMs: 1,
    })
    await useEverything(sdk)
    expect(watch.count()).toBe(0)
  })

  it('makes none after optOut(), even if the page keeps calling the SDK', async () => {
    const watch = watchNetwork()
    const sdk = startSdk({ autocapture: true })
    sdk.optOut()
    await useEverything(sdk)
    expect(watch.count()).toBe(0)
  })

  it('makes none when the visitor refused earlier, on the next page load', async () => {
    startSdk({ consent: 'pending' }).optOut()
    const watch = watchNetwork()
    const sdk = startSdk({ consent: 'granted', autocapture: true })
    await useEverything(sdk)
    expect(watch.count()).toBe(0)
  })

  it('makes none when Do Not Track or Global Privacy Control is on, even after optIn()', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })
    const watch = watchNetwork()
    const sdk = startSdk({ consent: 'pending', autocapture: true })
    sdk.optIn()
    await useEverything(sdk)
    expect(watch.count()).toBe(0)
  })

  it('starts sending, in order, only after optIn()', async () => {
    const watch = watchNetwork()
    const sdk = startSdk({ consent: 'pending', autocapture: true })
    sdk.track('before_consent')
    document.body.innerHTML = '<button id="c" type="button">Buy</button>'
    document.getElementById('c')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(60_000)
    await sdk.flush()
    expect(watch.count()).toBe(0)

    sdk.optIn()
    sdk.track('after_consent')
    await sdk.flush()
    expect(watch.fetch.calls.length).toBeGreaterThan(0)
    const sent = names(watch.fetch.calls)
    // What autocapture saw while consent was pending is kept in memory and sent now.
    expect(sent).toEqual(expect.arrayContaining(['page_view', 'click']))
    expect(sent.indexOf('before_consent')).toBeLessThan(sent.indexOf('after_consent'))
    // Only the ingest endpoint, only batches: no config or flag fetch ever appears.
    expect(new Set(watch.fetch.calls.map((c) => c.url))).toEqual(
      new Set(['https://ingest.test/v1/batch']),
    )
    expect(watch.xhr).not.toHaveBeenCalled()
    expect(watch.beacon).not.toHaveBeenCalled()
  })
})
