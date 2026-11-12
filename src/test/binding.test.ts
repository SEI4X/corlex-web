import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, KEY, mockFetch, startSdk } from './helpers'
afterEach(cleanup)
const KEY_B = 'ck_test_' + 'b'.repeat(43)
it('never replays another credential or proxy base scope but preserves its own offline history', async () => {
  const first = mockFetch(['network-error'])
  const a = startSdk({ config: { enabled: false } })
  a.identify('user_a')
  a.track('only_project_a')
  await a.flush()
  const aid = first.calls[0]?.events[0]?.anonymous_id
  a.destroy()
  const other = mockFetch()
  const b = startSdk({ key: KEY_B, config: { enabled: false } })
  b.track('only_project_b')
  await b.flush()
  expect(other.calls.flatMap((c) => c.events.map((e) => e.name))).toEqual(['only_project_b'])
  expect(other.calls[0]?.events[0]?.anonymous_id).not.toBe(aid)
  b.destroy()
  const proxy = startSdk({
    key: KEY,
    endpoint: 'https://ingest.test/other-cell',
    config: { enabled: false },
  })
  proxy.track('only_proxy')
  await proxy.flush()
  expect(other.calls.at(-1)?.events.map((e) => e.name)).toEqual(['only_proxy'])
  proxy.destroy()
  const restored = startSdk({ config: { enabled: false } })
  await restored.flush()
  expect(other.calls.at(-1)?.events.map((e) => e.name)).toContain('only_project_a')
  expect(other.calls.at(-1)?.events[0]?.anonymous_id).toBe(aid)
})
it('fences and wipes orphaned owners after global opt-out before reverting to an old credential', async () => {
  mockFetch(['network-error'])
  const a = startSdk({ config: { enabled: false } })
  a.track('old_a')
  await a.flush()
  const net = mockFetch()
  const b = startSdk({ key: KEY_B, config: { enabled: false } })
  b.optOut()
  a.track('stale_a')
  await a.flush()
  expect(net.calls).toHaveLength(0)
  b.optIn()
  b.track('new_b')
  await b.flush()
  const nextA = startSdk({ config: { enabled: false } })
  nextA.track('new_a')
  await nextA.flush()
  expect(net.calls.flatMap((c) => c.events.map((e) => e.name))).toEqual(['new_b', 'new_a'])
})
it('keeps a saved refusal closed if the next credential cannot read storage', async () => {
  const net = mockFetch()
  startSdk().optOut()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  const b = startSdk({ key: KEY_B, config: { enabled: false } })
  b.track('must_not_send')
  await b.flush()
  expect(b.getConsent()).toBe('pending')
  expect(net.calls).toHaveLength(0)
})
it('does not inherit session attribution or silently grant a newly pending owner', async () => {
  const net = mockFetch()
  history.replaceState({}, '', '/?utm_source=campaign_a')
  startSdk({ config: { enabled: false } }).track('a')
  history.replaceState({}, '', '/')
  const b = startSdk({ key: KEY_B, consent: 'pending', config: { enabled: false } })
  b.track('b')
  await b.flush()
  expect(b.getConsent()).toBe('pending')
  b.optIn()
  await b.flush()
  const event = net.calls.flatMap((c) => c.events).find((e) => e.name === 'b')
  expect(event?.properties.utm_source).toBeUndefined()
  expect(JSON.stringify(Object.entries(localStorage))).not.toContain(KEY_B)
})
it('discards legacy unbound identity and events while retaining a legacy refusal', async () => {
  const net = mockFetch()
  localStorage.setItem('corlex_consent', 'denied')
  localStorage.setItem('corlex_aid', 'legacy_person')
  localStorage.setItem('corlex_queue', '[{"name":"legacy_event"}]')
  localStorage.setItem('host_application', 'untouched')
  const sdk = startSdk({ config: { enabled: false } })
  expect(sdk.getConsent()).toBe('denied')
  sdk.optIn()
  sdk.track('new')
  await sdk.flush()
  expect(net.calls.flatMap((c) => c.events.map((e) => e.name))).toEqual(['new'])
  expect(net.calls[0]?.events[0]?.anonymous_id).not.toBe('legacy_person')
  expect(localStorage.getItem('host_application')).toBe('untouched')
  expect(localStorage.getItem('corlex_queue')).toBeNull()
})
it('fails closed for invalid privacy bookkeeping and sends only fresh memory after explicit opt-in', async () => {
  const net = mockFetch()
  localStorage.setItem('corlex_privacy_v1', '{broken')
  const sdk = startSdk({ config: { enabled: false } })
  sdk.track('before_choice')
  await sdk.flush()
  expect(net.calls).toHaveLength(0)
  sdk.optIn()
  sdk.track('after_choice')
  await sdk.flush()
  expect(net.calls.flatMap((c) => c.events.map((e) => e.name))).toEqual(['after_choice'])
})
it('fences already-loaded config values when another owner opts out', async () => {
  const { configServer, bool, CONFIG_ENDPOINT } = await import('./config-server')
  configServer([bool('private_config', true)])
  const a = startSdk({ configEndpoint: CONFIG_ENDPOINT })
  await a.config.ready()
  expect(a.config.get('private_config', false)).toBe(true)
  startSdk({ key: KEY_B, config: { enabled: false } }).optOut()
  expect(a.config.get('private_config', false)).toBe(false)
  expect(a.config.getAll()).toEqual({})
  expect(() => a.identify('must_not_persist')).not.toThrow()
})
it('retains a fresh pending privacy floor when reverting to a previously granted credential', async () => {
  const net = mockFetch()
  const a = startSdk({ config: { enabled: false } })
  a.track('old_a')
  await a.flush()
  startSdk({ key: KEY_B, consent: 'pending', config: { enabled: false } })
  const oldCount = net.calls.length
  a.track('stale_a')
  await a.flush()
  const reverted = startSdk({ config: { enabled: false } })
  reverted.track('held_a')
  await reverted.flush()
  expect(reverted.getConsent()).toBe('pending')
  expect(net.calls).toHaveLength(oldCount)
})
it.each([
  ['quota', 'denied'],
  ['quota', 'pending'],
  ['readback', 'denied'],
  ['readback', 'pending'],
] as const)(
  'observes an external privacy fence after %s write fault, external state=%s',
  async (failure, state) => {
    const net = mockFetch()
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      if (failure === 'quota') throw new Error('quota')
      // A write reported success but did not persist; verification must detect it.
    })
    const a = startSdk({ config: { enabled: false } })
    a.optIn()
    a.track('allowed_memory_session')
    await a.flush()
    expect(net.calls).toHaveLength(1)
    fail.mockRestore()
    // A different module instance models another browser realm, whose local latch cannot reset A.
    vi.resetModules()
    const otherRealm = await import('../binding/privacy')
    otherRealm.writePrivacy(state)
    a.track('must_not_send_after_external_refusal')
    await a.flush()
    expect(net.calls).toHaveLength(1)
    expect(a.getConsent()).toBe(state)
  },
)
it('keeps identity, queued event ids and cached config when an existing grant is repeated', async () => {
  const { configServer, bool, CONFIG_ENDPOINT } = await import('./config-server')
  const { sdkStored } = await import('./helpers')
  const server = configServer([bool('enabled', true)])
  let offline = true
  vi.stubGlobal(
    'fetch',
    vi.fn((url, init) => {
      if (!String(url).includes('/v1/config/') && offline) throw new TypeError('offline')
      return server.fn(url, init)
    }),
  )
  const sdk = startSdk({ configEndpoint: CONFIG_ENDPOINT })
  await sdk.config.ready()
  sdk.track('before_repeat')
  await sdk.flush()
  const before = JSON.parse(sdkStored('corlex_queue') ?? '[]')
  expect(before).toHaveLength(1)
  sdk.optIn()
  expect(JSON.parse(sdkStored('corlex_queue') ?? '[]')).toEqual(before)
  expect(sdk.config.get('enabled', false)).toBe(true)
  offline = false
  sdk.track('after_repeat')
  await sdk.flush()
  expect(server.events.map((e) => e.name)).toEqual(['before_repeat', 'after_repeat'])
  expect(server.events[0]?.event_id).toBe(before[0].event_id)
  expect(server.events[1]?.anonymous_id).toBe(before[0].anonymous_id)
  expect(server.calls).toHaveLength(1)
})
it('creates a fresh scope when explicitly reactivating a stale granted generation', async () => {
  const { bindingDigest, uuid } = await import('#core')
  const { writePrivacy } = await import('../binding/privacy')
  const net = mockFetch(),
    sdk = startSdk({ config: { enabled: false } })
  sdk.track('before')
  await sdk.flush()
  const original = net.calls[0]?.events[0]
  if (!original) throw new Error('missing fixture')
  const next = writePrivacy('granted')
  if (next.kind !== 'valid') throw new Error('missing privacy fixture')
  const owner = bindingDigest({
    key: KEY,
    endpoint: 'https://ingest.test',
    configEndpoint: 'https://config.corlex.ru',
  })
  const prefix = `corlex_scope_v1:${owner}:${next.generation}:`
  localStorage.setItem(prefix + 'corlex_aid', 'a_untrusted_prior_generation')
  localStorage.setItem(
    prefix + 'corlex_queue',
    JSON.stringify([{ ...original, event_id: uuid(), name: 'must_not_replay' }]),
  )
  net.calls.length = 0
  expect(sdk.getConsent()).toBe('pending')
  sdk.optIn()
  sdk.track('after_reactivation')
  await sdk.flush()
  expect(net.calls.flatMap((c) => c.events.map((e) => e.name))).toEqual(['after_reactivation'])
  expect(net.calls[0]?.events[0]?.anonymous_id).not.toBe('a_untrusted_prior_generation')
})
it('keeps bound credential and endpoint values immutable after init options are changed by the caller', async () => {
  const { Corlex } = await import('../client')
  const net = mockFetch(),
    options = {
      key: KEY,
      endpoint: 'https://ingest.test',
      autocapture: false as const,
      config: { enabled: false },
    }
  const sdk = new Corlex()
  try {
    sdk.init(options)
    options.key = KEY_B
    options.endpoint = 'https://foreign.test'
    sdk.optOut()
    sdk.optIn()
    sdk.track('after_choice')
    await sdk.flush()
    expect(net.calls[0]?.headers['X-Corlex-Key']).toBe(KEY)
    expect(net.calls[0]?.url).toBe('https://ingest.test/v1/batch')
  } finally {
    sdk.destroy()
  }
})
it('distinguishes configured default grant from an actual opt-in on a later pending restart', () => {
  mockFetch()
  const options = { config: { enabled: false } } as const
  startSdk(options).destroy()
  const pending = startSdk({ ...options, consent: 'pending' })
  expect(pending.getConsent()).toBe('pending')
  pending.optIn()
  pending.destroy()
  const granted = startSdk({ ...options, consent: 'pending' })
  expect(granted.getConsent()).toBe('granted')
  granted.destroy()
  // Default granted startup alone is not an explicit saved choice.
  cleanup()
  const first = startSdk(options)
  first.optIn()
  first.destroy()
  expect(startSdk({ ...options, consent: 'pending' }).getConsent()).toBe('granted')
})
