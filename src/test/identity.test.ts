import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, expectProtocolValid, mockFetch, startSdk } from './helpers'
import { rejectionReason } from '#core/test-protocol'

afterEach(cleanup)

const sent = async (
  sdk: ReturnType<typeof startSdk>,
  calls: ReturnType<typeof mockFetch>['calls'],
) => {
  await sdk.flush()
  return calls.flatMap((c) => c.events)
}

describe('identity', () => {
  it('gives every event a unique uuid, an anonymous id and web context', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('a')
    sdk.track('b')
    const [a, b] = await sent(sdk, calls)
    expect(a?.event_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a?.event_id).not.toBe(b?.event_id)
    expect(a?.anonymous_id).toMatch(/^a_/)
    expect(a?.user_id).toBeUndefined()
    expect(a?.context.platform).toBe('web')
    expect(a?.context.sdk.name).toBe('corlex-web')
    expectProtocolValid(calls)
  })

  it('keeps the anonymous id across reloads', async () => {
    const first = mockFetch()
    const one = startSdk()
    one.track('a')
    const [before] = await sent(one, first.calls)
    const second = mockFetch()
    const two = startSdk()
    two.track('b')
    const [after] = await sent(two, second.calls)
    expect(after?.anonymous_id).toBe(before?.anonymous_id)
  })

  it('requires a fresh explicit grant without writing an unbound identity cookie when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const sdk = startSdk()
    expect(sdk.getConsent()).toBe('pending')
    expect(document.cookie).toBe('')
    sdk.optIn()
    expect(sdk.getConsent()).toBe('granted')
    expect(document.cookie).toBe('')
  })

  it('identify sets user_id on later events and emits corlex.identify with traits', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('before')
    sdk.identify('u_42', { plan: 'pro' })
    sdk.track('after')
    const events = await sent(sdk, calls)
    expect(events.map((e) => e.name)).toEqual(['before', 'corlex.identify', 'after'])
    expect(events[0]?.user_id).toBeUndefined()
    expect(events[1]?.user_id).toBe('u_42')
    expect(events[1]?.properties['plan']).toBe('pro')
    expect(events[1]?.anonymous_id).toBe(events[0]?.anonymous_id)
    expect(events[2]?.user_id).toBe('u_42')
    expectProtocolValid(calls)
  })

  it('remembers the user after a reload', async () => {
    mockFetch()
    startSdk().identify('u_42')
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.track('x')
    const events = await sent(sdk, calls)
    expect(events.find((e) => e.name === 'x')?.user_id).toBe('u_42')
  })

  it('reset() forgets the user and starts a new anonymous id', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.identify('u_42')
    sdk.track('logged_in')
    sdk.reset()
    sdk.track('logged_out')
    const events = await sent(sdk, calls)
    const [inEvent, outEvent] = [events.at(-2), events.at(-1)]
    expect(outEvent?.user_id).toBeUndefined()
    expect(outEvent?.anonymous_id).not.toBe(inEvent?.anonymous_id)
  })

  it('setUserProperties emits corlex.user_props with the properties', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.setUserProperties({ company: 'Acme', seats: 5 })
    const [event] = await sent(sdk, calls)
    expect(event?.name).toBe('corlex.user_props')
    expect(event?.properties).toMatchObject({ company: 'Acme', seats: 5 })
    expectProtocolValid(calls)
  })

  it('ignores empty or non-string user ids', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk()
    sdk.identify('')
    sdk.identify(42 as unknown as string)
    expect(await sent(sdk, calls)).toHaveLength(0)
  })

  it('flag() returns the default until remote config exists', () => {
    const sdk = startSdk()
    expect(sdk.flag('new_checkout', false)).toBe(false)
    expect(sdk.flag('limit', 5)).toBe(5)
    expect(sdk.flag('variant', 'a')).toBe('a')
  })
})

describe('the protocol validator itself', () => {
  const ok = {
    event_id: '0192f3a0-0000-7000-8000-000000000001',
    name: 'a',
    timestamp: new Date().toISOString(),
    anonymous_id: 'x',
    properties: {},
  }

  it('accepts a good event and rejects broken ones', () => {
    expect(rejectionReason(ok)).toBe('')
    expect(rejectionReason({ ...ok, name: 'Bad Name' })).toBe('name_invalid')
    expect(rejectionReason({ ...ok, event_id: 'nope' })).toBe('event_id_invalid')
    expect(rejectionReason({ ...ok, anonymous_id: '' })).toBe('identity_missing')
    expect(rejectionReason({ ...ok, timestamp: '1999-01-01T00:00:00Z' })).toBe('timestamp_invalid')
    expect(rejectionReason({ ...ok, properties: { s: 'x'.repeat(1025) } })).toBe(
      'properties_invalid',
    )
    expect(rejectionReason({ ...ok, properties: { a: { b: { c: { d: { e: 1 } } } } } })).toBe(
      'properties_invalid',
    )
    expect(rejectionReason({ ...ok, context: { platform: 'tv' } })).toBe('context_invalid')
  })
})
