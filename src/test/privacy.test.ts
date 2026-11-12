import { sdkStored } from './helpers'
import { afterEach, describe, expect, it } from 'vitest'
import { QUEUE_KEY } from '#core'
import { cleanup, expectProtocolValid, mockFetch, names, startSdk } from './helpers'

afterEach(cleanup)

function setDnt(value: string, gpc?: boolean) {
  Object.defineProperty(navigator, 'doNotTrack', { value, configurable: true })
  if (gpc !== undefined) {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc, configurable: true })
  }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'doNotTrack')
  Reflect.deleteProperty(navigator, 'globalPrivacyControl')
})

describe('Do Not Track', () => {
  it('collects nothing and stores nothing when DNT is 1', async () => {
    const { calls } = mockFetch()
    setDnt('1')
    const sdk = startSdk({ autocapture: true })
    sdk.track('a')
    sdk.identify('u')
    await sdk.flush()
    expect(calls).toHaveLength(0)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('also honors Global Privacy Control', async () => {
    const { calls } = mockFetch()
    setDnt('0', true)
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    expect(calls).toHaveLength(0)
  })

  it('is not overridden by optIn()', async () => {
    const { calls } = mockFetch()
    setDnt('1')
    const sdk = startSdk()
    sdk.optIn()
    sdk.track('a')
    await sdk.flush()
    expect(calls).toHaveLength(0)
  })

  it('collects normally with respectDnt: false', async () => {
    const { calls } = mockFetch()
    setDnt('1')
    const sdk = startSdk({ respectDnt: false })
    sdk.track('a')
    await sdk.flush()
    expect(names(calls)).toEqual(['a'])
  })

  it('collects normally when DNT is 0 or unset', async () => {
    const { calls } = mockFetch()
    setDnt('0')
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    expect(names(calls)).toEqual(['a'])
  })
})

describe('consent', () => {
  it('holds events in memory only while consent is pending', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ consent: 'pending' })
    sdk.track('early')
    await sdk.flush()
    expect(calls).toHaveLength(0)
    expect(localStorage.length).toBe(1)
    expect(JSON.parse(localStorage.getItem('corlex_privacy_v1') ?? '{}').state).toBe('pending')
    expect(document.cookie).toBe('')
    expect(sessionStorage.length).toBe(0)
  })

  it('sends the held events after optIn() and starts persisting', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ consent: 'pending' })
    sdk.track('early')
    sdk.optIn()
    sdk.track('late')
    expect(sdkStored(QUEUE_KEY)).toContain('late')
    await sdk.flush()
    expect(names(calls)).toEqual(['early', 'late'])
    expectProtocolValid(calls)
  })

  it('remembers the choice for the next page', async () => {
    mockFetch()
    startSdk({ consent: 'pending' }).optIn()
    const { calls } = mockFetch()
    const next = startSdk({ consent: 'pending' })
    next.track('a')
    await next.flush()
    expect(names(calls)).toEqual(['a'])
  })

  it('getConsent() tells a consent banner whether the visitor still has to choose', () => {
    mockFetch()
    const sdk = startSdk({ consent: 'pending' })
    expect(sdk.getConsent()).toBe('pending')
    sdk.optIn()
    expect(sdk.getConsent()).toBe('granted')
    expect(startSdk({ consent: 'pending' }).getConsent()).toBe('granted')
    sdk.optOut()
    expect(sdk.getConsent()).toBe('denied')
    expect(startSdk({ consent: 'pending' }).getConsent()).toBe('denied')
  })

  it('getConsent() reports denied when the browser asks not to be tracked', () => {
    setDnt('1')
    expect(startSdk({ consent: 'pending' }).getConsent()).toBe('denied')
  })

  it('optOut() clears the queue and storage and stops collecting', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.identify('u_1')
    sdk.track('a')
    sdk.optOut()
    sdk.track('b')
    await sdk.flush()
    expect(calls).toHaveLength(0)
    expect(sdkStored(QUEUE_KEY)).toBeNull()
    expect(localStorage.getItem('corlex_aid')).toBeNull()
    expect(localStorage.getItem('corlex_uid')).toBeNull()
    expect(document.cookie).not.toContain('corlex_aid')
  })

  it('stays off on the next page after optOut()', async () => {
    mockFetch()
    startSdk().optOut()
    const { calls } = mockFetch()
    const next = startSdk()
    next.track('a')
    await next.flush()
    expect(calls).toHaveLength(0)
  })

  it('can be switched back on with optIn() after an opt-out, with a fresh identity', async () => {
    const first = mockFetch()
    const sdk = startSdk()
    sdk.track('a')
    await sdk.flush()
    const oldId = first.calls[0]?.events[0]?.anonymous_id
    sdk.optOut()
    sdk.optIn()
    sdk.track('b')
    await sdk.flush()
    expect(first.calls.at(-1)?.events[0]?.anonymous_id).not.toBe(oldId)
  })
})
