import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot, parseAutocapture, readScriptOptions } from '../boot'
import { SDK_VERSION } from '../version'
import { cleanup, ENDPOINT, expectProtocolValid, KEY, mockFetch, names } from './helpers'

afterEach(() => {
  delete (window as { corlex?: unknown }).corlex
  cleanup()
})

function scriptTag(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script')
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v)
  return script
}

describe('snippet', () => {
  it('reads data-* attributes from its own script tag', () => {
    const options = readScriptOptions(
      scriptTag({ 'data-key': KEY, 'data-endpoint': ENDPOINT, 'data-autocapture': 'clicks,forms' }),
    )
    expect(options).toEqual({
      key: KEY,
      endpoint: ENDPOINT,
      autocapture: { pageViews: false, clicks: true, forms: true, errors: false },
    })
    expect(readScriptOptions(scriptTag({}))).toBeNull()
    expect(readScriptOptions(null)).toBeNull()
    expect(parseAutocapture('false')).toBe(false)
    expect(parseAutocapture(null)).toBe(true)
  })

  it('enables insecure HTTP only with an explicit developer attribute', () => {
    expect(readScriptOptions(scriptTag({ 'data-key': KEY }))?.allowInsecureHttp).toBeUndefined()
    expect(
      readScriptOptions(scriptTag({ 'data-key': KEY, 'data-allow-insecure-http': 'false' }))
        ?.allowInsecureHttp,
    ).toBeUndefined()
    expect(
      readScriptOptions(scriptTag({ 'data-key': KEY, 'data-allow-insecure-http': 'true' }))
        ?.allowInsecureHttp,
    ).toBe(true)
  })

  it('replays calls queued before load from an array and from a stub function', async () => {
    const { calls } = mockFetch()
    const stub = Object.assign(() => {}, {
      q: [
        ['track', 'from_stub', { n: 1 }],
        ['identify', 'u_7'],
      ],
    })
    ;(window as { corlex?: unknown }).corlex = stub
    const api = boot(
      scriptTag({ 'data-key': KEY, 'data-endpoint': ENDPOINT, 'data-autocapture': 'false' }),
      window,
    )
    expect((window as { corlex?: unknown }).corlex).toBe(api)
    api.track('after_load')
    await api.flush()
    expect(names(calls)).toEqual(['from_stub', 'corlex.identify', 'after_load'])
    expectProtocolValid(calls)
    expect(calls[0]?.events[0]?.properties['n']).toBe(1)
    api.optOut()
  })

  it('accepts a plain array as the pre-init stub and ignores unknown methods', async () => {
    const { calls } = mockFetch()
    ;(window as { corlex?: unknown }).corlex = [['track', 'early'], ['hack', 'x'], ['constructor']]
    const api = boot(
      scriptTag({ 'data-key': KEY, 'data-endpoint': ENDPOINT, 'data-autocapture': 'false' }),
      window,
    )
    await api.flush()
    expect(names(calls)).toEqual(['early'])
    api.optOut()
  })

  it('collects page views by default and survives a missing key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = boot(scriptTag({}), window)
    api.track('ignored')
    expect(await api.flush()).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('package', () => {
  it('SDK_VERSION equals package.json version', () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'))
    expect(SDK_VERSION).toBe(pkg.version)
  })
})
