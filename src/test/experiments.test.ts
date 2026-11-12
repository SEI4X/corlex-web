import { sdkStored } from './helpers'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EXPOSURE_KEY } from '#core'
import { CONFIG_ENDPOINT, bool, configServer, type Experiments } from './config-server'
import { KEY, cleanup, startSdk } from './helpers'
import type { InitOptions, WireEvent } from '../types'

afterEach(cleanup)

const launch = (options: Partial<InitOptions> = {}) =>
  startSdk({ configEndpoint: CONFIG_ENDPOINT, ...options })

const test50: Experiments = [
  {
    k: 'paywall_test',
    s: 'a1b2c3d4',
    v: [
      { n: 'control', b: 5000, v: false },
      { n: 'variant_b', b: 10000, v: true },
    ],
  },
]
const linked: Experiments = test50.map((e) => ({ ...e, k: 'onboarding_test', p: 'onboarding_v2' }))

const exposures = (events: WireEvent[]) =>
  events.filter((event) => event.name === 'corlex.exposure')

async function ready(sdk: ReturnType<typeof launch>): Promise<void> {
  await sdk.config.ready()
}

describe('experiment()', () => {
  it('gives the same variant as the shared vectors (the other languages assign the same way)', async () => {
    // vitest runs in the package folder; jsdom has no file URL for the test itself.
    const file = resolve(process.cwd(), 'test-vectors/remote-config.json')
    const vectors = JSON.parse(readFileSync(file, 'utf8')) as {
      experiments: {
        name: string
        experiment: Experiments[number]
        userId: string
        expected: { variant: string; value: unknown }
      }[]
    }
    let checked = 0
    for (const c of vectors.experiments.filter((v) => v.userId !== '')) {
      configServer([], [c.experiment])
      const sdk = launch()
      sdk.identify(c.userId)
      await ready(sdk)
      expect(sdk.experiment(c.experiment.k), c.name).toEqual({
        variant: c.expected.variant,
        value: c.expected.value,
      })
      sdk.destroy()
      cleanup()
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(15)
  })

  it('is null when the test is not running, unknown, or the config is not there yet', async () => {
    const server = configServer([bool('x_flag', true)])
    const sdk = launch()
    expect(sdk.experiment('paywall_test')).toBeNull()
    await ready(sdk)
    expect(sdk.experiment('paywall_test')).toBeNull()
    server.publish([], test50)
    await sdk.config.refresh()
    sdk.destroy()
    expect(server.events.filter((e) => e.name === 'corlex.exposure')).toEqual([])
  })

  it('keeps a person in one variant across launches', async () => {
    configServer([], test50)
    const first = launch()
    first.identify('person-9')
    await ready(first)
    const variant = first.experiment('paywall_test')?.variant
    first.destroy()
    const second = launch()
    second.identify('person-9')
    await ready(second)
    expect(second.experiment('paywall_test')?.variant).toBe(variant)
  })
})

describe('exposures', () => {
  it('sends one corlex.exposure when the variant is read, with the test and the variant', async () => {
    const server = configServer([], test50)
    const sdk = launch()
    sdk.identify('person-1')
    await ready(sdk)
    const assigned = sdk.experiment('paywall_test')
    await sdk.flush()
    const sent = exposures(server.events)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.properties).toMatchObject({
      experiment: 'paywall_test',
      variant: assigned?.variant,
    })
    expect(sent[0]?.user_id).toBe('person-1')
  })

  it('sends nothing until the variant is read: being assigned is not being exposed', async () => {
    const server = configServer([], test50)
    const sdk = launch()
    await ready(sdk)
    sdk.track('page_seen')
    await sdk.flush()
    expect(exposures(server.events)).toEqual([])
  })

  it('does not repeat in a session: not on a second read, not after a reload of the page', async () => {
    const server = configServer([], test50)
    const sdk = launch()
    sdk.identify('person-1')
    await ready(sdk)
    for (let i = 0; i < 5; i += 1) sdk.experiment('paywall_test')
    sdk.destroy()
    const reloaded = launch()
    reloaded.identify('person-1')
    await ready(reloaded)
    reloaded.experiment('paywall_test')
    await reloaded.flush()
    expect(exposures(server.events)).toHaveLength(1)
    expect(sdkStored(EXPOSURE_KEY, sessionStorage)).not.toContain('person-1')
  })

  it('sends again for another person, and after reset() (a logout)', async () => {
    const server = configServer([], test50)
    const sdk = launch()
    sdk.identify('person-1')
    await ready(sdk)
    sdk.experiment('paywall_test')
    sdk.identify('person-2')
    sdk.experiment('paywall_test')
    sdk.reset()
    sdk.experiment('paywall_test')
    await sdk.flush()
    expect(exposures(server.events)).toHaveLength(3)
  })

  it('counts a read of the linked parameter as the exposure, and getAll() as none', async () => {
    const server = configServer([bool('onboarding_v2', false)], linked)
    const sdk = launch()
    sdk.identify('person-3')
    await ready(sdk)
    const all = sdk.config.getAll()
    await sdk.flush()
    expect(exposures(server.events)).toEqual([])
    const value = sdk.config.get('onboarding_v2', false)
    expect(value).toBe(all['onboarding_v2'])
    await sdk.flush()
    expect(exposures(server.events)).toHaveLength(1)
    expect(sdk.experiment('onboarding_test')?.value).toBe(value)
  })

  it('serves the fallback, without an exposure, when the variant is of another type', async () => {
    const server = configServer([bool('onboarding_v2', false)], linked)
    const sdk = launch()
    await ready(sdk)
    expect(sdk.config.get('onboarding_v2', 'text')).toBe('text')
    await sdk.flush()
    expect(exposures(server.events)).toEqual([])
  })

  it("shows the parameter's own value again once the test is stopped", async () => {
    const server = configServer([bool('onboarding_v2', false)], linked)
    const sdk = launch({ config: { live: true } })
    sdk.identify('person-4')
    await ready(sdk)
    const during = sdk.config.get('onboarding_v2', false)
    server.publish([bool('onboarding_v2', true)])
    await sdk.config.refresh()
    expect(sdk.config.get('onboarding_v2', false)).toBe(true)
    expect(typeof during).toBe('boolean')
    expect(sdk.experiment('onboarding_test')).toBeNull()
  })
})

describe('consent', () => {
  it('assigns nothing and sends nothing before consent, and exposes after optIn()', async () => {
    const server = configServer([], test50)
    const sdk = launch({ consent: 'pending' })
    expect(sdk.experiment('paywall_test')).toBeNull()
    expect(server.calls).toHaveLength(0)
    sdk.optIn()
    await ready(sdk)
    sdk.identify('person-1')
    expect(sdk.experiment('paywall_test')).not.toBeNull()
    await sdk.flush()
    expect(exposures(server.events)).toHaveLength(1)
    expect(KEY).toBeDefined()
  })

  it('forgets everything on optOut()', async () => {
    configServer([], test50)
    const sdk = launch()
    await ready(sdk)
    sdk.experiment('paywall_test')
    expect(sdkStored(EXPOSURE_KEY, sessionStorage)).not.toBeNull()
    sdk.optOut()
    expect(sdkStored(EXPOSURE_KEY, sessionStorage)).toBeNull()
    expect(sdk.experiment('paywall_test')).toBeNull()
  })
})
