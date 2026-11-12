import { sdkStored } from './helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANON_KEY, CONFIG_KEY } from '#core'
import type { InitOptions } from '../types'
import { CONFIG_ENDPOINT, bool, configServer } from './config-server'
import { KEY, cleanup, startSdk } from './helpers'

afterEach(cleanup)

const launch = (options: Partial<InitOptions> = {}) =>
  startSdk({ configEndpoint: CONFIG_ENDPOINT, ...options })

describe('downloading the config', () => {
  it('sends the project key in a header, no id of a person, nothing in the URL', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const sdk = launch()
    sdk.identify('person-42')
    await sdk.config.ready()
    expect(server.calls).toHaveLength(1)
    const [call] = server.calls
    expect(call?.url).toBe(`${CONFIG_ENDPOINT}/v1/config/document`)
    expect(call?.headers).toEqual({ 'X-Corlex-Key': KEY })
    expect(call?.body).toBeUndefined()
    const anonymousId = sdkStored(ANON_KEY) ?? ''
    expect(anonymousId).not.toBe('')
    expect(JSON.stringify(call)).not.toContain('person-42')
    expect(JSON.stringify(call)).not.toContain(anonymousId)
  })

  it('revalidates with the saved ETag on the next launch and gets a 304', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const first = launch()
    await first.config.ready()
    first.destroy()

    const second = launch()
    await second.config.ready()
    expect(server.calls.map((c) => c.headers['If-None-Match'])).toEqual([undefined, '"v1-test"'])
    expect(second.config.get('onboarding_v2', false)).toBe(true)
  })

  it('keeps what it has when the server is down, answers garbage or knows no config', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const first = launch()
    await first.config.ready()
    first.destroy()
    for (const mode of ['down', 'garbage'] as const) {
      server.breakIt(mode)
      const again = launch()
      await again.config.ready()
      expect(again.config.get('onboarding_v2', false), mode).toBe(true)
      again.destroy()
    }
    const empty = configServer()
    localStorage.removeItem(CONFIG_KEY)
    const fresh = launch()
    await fresh.config.ready()
    expect(empty.calls).toHaveLength(1)
    expect(fresh.config.get('onboarding_v2', 'fallback')).toBe('fallback')
  })

  it('stops waiting for a slow server after the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', () => new Promise(() => undefined))
    const sdk = launch({ config: { timeoutMs: 300 } })
    let done = false
    void sdk.config.ready().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })
})

describe('reading values', () => {
  it('returns the value for the visitor and the fallback for everything else', async () => {
    configServer([
      bool('onboarding_v2', true),
      { k: 'free_trial_days', t: 'number', v: 7, r: 10000 },
      { k: 'steps', t: 'json', v: ['a', 'b'], r: 10000 },
      bool('show_meal_reminder', true, { r: 0 }),
    ])
    const sdk = launch()
    await sdk.config.ready()
    expect(sdk.config.get('onboarding_v2', false)).toBe(true)
    expect(sdk.config.get('free_trial_days', 3)).toBe(7)
    expect(sdk.config.get('steps', [] as string[])).toEqual(['a', 'b'])
    // Not reached by a 0 % rollout, not there at all, or of another type than the fallback.
    expect(sdk.config.get('show_meal_reminder', false)).toBe(false)
    expect(sdk.config.get('missing_one', 'x')).toBe('x')
    expect(sdk.config.get('free_trial_days', 'three')).toBe('three')
    expect(sdk.config.get('steps', {})).toEqual({})
    expect(sdk.config.getAll()).toEqual({
      onboarding_v2: true,
      free_trial_days: 7,
      steps: ['a', 'b'],
    })
    expect(sdk.flag('free_trial_days', 1)).toBe(7)
  })

  it('applies the platform override for the web before the rollout', async () => {
    configServer([
      bool('paywall_variant', false, { r: 0, o: { web: true } }),
      bool('mobile_only', true, { o: { web: false } }),
    ])
    const sdk = launch()
    await sdk.config.ready()
    expect(sdk.config.get('paywall_variant', false)).toBe(true)
    expect(sdk.config.get('mobile_only', true)).toBe(false)
  })

  it('puts the same visitor in the same share again and again, and moves with the user id', async () => {
    configServer([bool('half', true, { r: 5000 })])
    const groups: boolean[] = []
    for (let i = 0; i < 40; i += 1) {
      localStorage.clear()
      const sdk = launch()
      sdk.identify(`user-${i}`)
      await sdk.config.ready()
      const once = sdk.config.get('half', false)
      expect(sdk.config.get('half', false)).toBe(once)
      groups.push(once)
      sdk.destroy()
      const again = launch()
      again.identify(`user-${i}`)
      expect(again.config.get('half', false)).toBe(once)
      again.destroy()
    }
    const share = groups.filter(Boolean).length / groups.length
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.75)
  })

  it('answers with the fallback until consent is given', () => {
    configServer([bool('onboarding_v2', true)])
    expect(startSdk({ consent: 'pending' }).config.get('onboarding_v2', false)).toBe(false)
  })
})

describe('when a published config takes effect', () => {
  it('applies a new config at the next launch, never in the middle of one', async () => {
    const server = configServer([{ k: 'free_trial_days', t: 'number', v: 7, r: 10000 }])
    const first = launch()
    await first.config.ready()
    expect(first.config.get('free_trial_days', 0)).toBe(7)
    first.destroy()

    server.publish([{ k: 'free_trial_days', t: 'number', v: 14, r: 10000 }])
    const second = launch()
    const updates: unknown[] = []
    second.config.onUpdate((u) => updates.push(u))
    // The app reads at once, as most do: it gets the saved config and keeps it all session.
    expect(second.config.get('free_trial_days', 0)).toBe(7)
    await second.config.ready()
    expect(second.config.get('free_trial_days', 0)).toBe(7)
    expect(updates).toEqual([{ version: 2, applied: false }])
    second.destroy()

    const third = launch()
    expect(third.config.get('free_trial_days', 0)).toBe(14)
  })

  it('applies it at once when the app waits for ready() before its first read', async () => {
    const server = configServer([{ k: 'free_trial_days', t: 'number', v: 7, r: 10000 }])
    const first = launch()
    await first.config.ready()
    first.destroy()

    server.publish([{ k: 'free_trial_days', t: 'number', v: 14, r: 10000 }])
    const second = launch()
    await second.config.ready()
    expect(second.config.get('free_trial_days', 0)).toBe(14)
  })

  it('applies it at once in live mode and says so', async () => {
    const server = configServer([bool('onboarding_v2', false)])
    const sdk = launch({ config: { live: true } })
    await sdk.config.ready()
    expect(sdk.config.get('onboarding_v2', true)).toBe(false)
    const updates: unknown[] = []
    const stop = sdk.config.onUpdate((u) => updates.push(u))
    server.publish([bool('onboarding_v2', true)])
    await sdk.config.refresh()
    expect(sdk.config.get('onboarding_v2', false)).toBe(true)
    expect(updates).toEqual([{ version: 2, applied: true }])
    stop()
    server.publish([bool('onboarding_v2', false)])
    await sdk.config.refresh()
    expect(updates).toHaveLength(1)
  })

  it('shares one request between concurrent refreshes', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const sdk = launch()
    await Promise.all([sdk.config.refresh(), sdk.config.refresh(), sdk.config.ready()])
    expect(server.calls).toHaveLength(1)
  })
})

describe('consent', () => {
  it('downloads nothing while consent is pending, then starts on optIn()', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const sdk = launch({ consent: 'pending' })
    await sdk.config.ready()
    await sdk.config.refresh()
    expect(server.fn).not.toHaveBeenCalled()
    expect(sdk.config.get('onboarding_v2', false)).toBe(false)
    expect(sdkStored(CONFIG_KEY)).toBeNull()

    sdk.optIn()
    await sdk.config.ready()
    expect(server.calls).toHaveLength(1)
    expect(sdk.config.get('onboarding_v2', false)).toBe(true)
  })

  it('forgets the saved config and stops downloading on optOut()', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const sdk = launch()
    await sdk.config.ready()
    expect(sdkStored(CONFIG_KEY)).not.toBeNull()
    sdk.optOut()
    expect(sdkStored(CONFIG_KEY)).toBeNull()
    expect(sdk.config.get('onboarding_v2', false)).toBe(false)
    await sdk.config.refresh()
    expect(server.calls).toHaveLength(1)
  })

  it('can be switched off', async () => {
    const server = configServer([bool('onboarding_v2', true)])
    const sdk = launch({ config: { enabled: false } })
    await sdk.config.ready()
    expect(server.fn).not.toHaveBeenCalled()
  })
})
