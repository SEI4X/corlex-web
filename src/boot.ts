import { Corlex } from './client'
import type { AutocaptureOptions, CorlexApi, InitOptions } from './types'

const METHODS = [
  'init',
  'track',
  'identify',
  'setUserProperties',
  'flag',
  'experiment',
  'reset',
  'flush',
  'optIn',
  'optOut',
] as const

type Method = (typeof METHODS)[number]

const isMethod = (name: unknown): name is Method => METHODS.includes(name as Method)

const PARTS: Record<string, keyof AutocaptureOptions> = {
  pageviews: 'pageViews',
  clicks: 'clicks',
  forms: 'forms',
  errors: 'errors',
}

/** `data-autocapture`: absent or "true" is everything, "false" nothing, else a list such as "pageviews,clicks". */
export function parseAutocapture(value: string | null): boolean | AutocaptureOptions {
  if (value === null || value === '' || value === 'true') return true
  if (value === 'false') return false
  const wanted = value.split(',').map((part) => part.trim().toLowerCase())
  const options: AutocaptureOptions = {}
  for (const [token, key] of Object.entries(PARTS)) options[key] = wanted.includes(token)
  return options
}

/** Settings from the `<script data-key=… data-endpoint=… …>` tag, or null without a key. */
export function readScriptOptions(script: HTMLScriptElement | null): InitOptions | null {
  const key = script?.getAttribute('data-key')
  if (!script || !key) return null
  const options: InitOptions = {
    key,
    autocapture: parseAutocapture(script.getAttribute('data-autocapture')),
  }
  const endpoint = script.getAttribute('data-endpoint')
  if (endpoint) options.endpoint = endpoint
  const configEndpoint = script.getAttribute('data-config-endpoint')
  if (configEndpoint) options.configEndpoint = configEndpoint
  if (script.getAttribute('data-consent') === 'pending') options.consent = 'pending'
  if (script.getAttribute('data-debug') === 'true') options.debug = true
  if (script.getAttribute('data-capture-error-messages') === 'true')
    options.captureErrorMessages = true
  if (script.getAttribute('data-allow-insecure-http') === 'true') options.allowInsecureHttp = true
  return options
}

/** Calls made before the script loaded: `corlex.q` of a stub function, or a plain array. */
function earlyCalls(stub: unknown): ArrayLike<unknown>[] {
  const list = Array.isArray(stub) ? stub : (stub as { q?: unknown } | undefined)?.q
  return Array.isArray(list) ? list.filter((call) => call && typeof call === 'object') : []
}

/**
 * Starts the snippet: reads the script tag, replays calls queued by the page
 * before this file loaded (`window.corlex = []`, or a stub function with `.q`),
 * and replaces `window.corlex` with the real API.
 */
export function boot(
  script: HTMLScriptElement | null,
  win: Window & { corlex?: unknown },
): CorlexApi {
  const sdk = new Corlex()
  const queued = earlyCalls(win.corlex)
  const call = (method: Method, args: unknown[]): unknown =>
    (sdk[method] as (...a: unknown[]) => unknown).apply(sdk, args)
  const options = readScriptOptions(script)
  if (options) sdk.init(options)
  for (const item of queued) {
    const [method, ...args] = Array.from(item)
    if (isMethod(method)) call(method, args)
  }
  const api = Object.fromEntries(
    METHODS.map((name) => [name, (...args: unknown[]) => call(name, args)]),
  ) as unknown as CorlexApi
  Object.defineProperty(api, 'config', { value: sdk.config, enumerable: true })
  win.corlex = api
  return api
}
