import type { KeyValueStore, Platform, PlatformHost, Properties } from '#core'
import { resolveAutocapture, startAutocapture } from './autocapture/index'
import { baseContext, pageProperties } from './context'
import { browserOptedOut } from './privacy'
import { clearSession, collectSession, persistSession } from './session'
import { BindingController, bindingDigest, MemoryStore } from '#core'
import { WebBindingDriver } from './binding/driver'
import type { InitOptions } from './types'

/** The browser: localStorage, page context, pagehide delivery and autocapture. */
export class WebPlatform implements Platform<InitOptions> {
  readonly name = 'web'
  readonly keepalive = true
  readonly stores = {
    persistent: new MemoryStore() as KeyValueStore,
    identity: new MemoryStore() as KeyValueStore,
    session: new MemoryStore() as KeyValueStore,
  }

  bind(options: InitOptions, invalidate: () => void): BindingController | undefined {
    const owner = bindingDigest({
      ...options,
      endpoint: options.endpoint ?? '',
      configEndpoint: options.configEndpoint ?? '',
    })
    if (!owner) return undefined
    const driver = new WebBindingDriver(owner, options.consent ?? 'granted')
    const binding = new BindingController({
      owner,
      scope: driver.prepare(),
      requested: options.consent ?? 'granted',
      driver,
      onInvalidate: invalidate,
    })
    Object.assign(this.stores, binding.stores)
    this.request = binding.request((url, init) => globalThis.fetch(url, init))
    return binding
  }
  request: import('#core').SDKRequest = (url, init) => globalThis.fetch(url, init)

  /** Campaign tags and the external referrer of this session. */
  private session: Properties = {}

  context = baseContext

  eventProperties(): Properties {
    return { ...pageProperties(), ...this.session }
  }

  isBlocked(options: InitOptions): boolean {
    return (options.respectDnt ?? true) && browserOptedOut()
  }

  start(options: InitOptions, host: PlatformHost, granted: boolean): () => void {
    this.session = collectSession(options.captureQueryParams, this.stores.session)
    if (granted) persistSession(this.session, this.stores.session)
    const stopExit = listenForExit(host)
    const stopAuto = startAutocapture(
      {
        ...resolveAutocapture(options.autocapture),
        captureErrorMessages: options.captureErrorMessages === true,
      },
      host,
      this.stores.session,
    )
    return () => {
      stopExit()
      stopAuto()
    }
  }

  onConsentGranted(): void {
    persistSession(this.session, this.stores.session)
  }

  onOptOut(): void {
    clearSession(this.stores.session)
  }
}

/** Delivery on the way out: fetch keepalive survives the page being closed. */
function listenForExit(host: PlatformHost): () => void {
  const flush = () => void host.flush({ unload: true })
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  addEventListener('pagehide', flush)
  addEventListener('visibilitychange', onVisibility)
  return () => {
    removeEventListener('pagehide', flush)
    removeEventListener('visibilitychange', onVisibility)
  }
}
