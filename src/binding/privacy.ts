import { uuid } from '#core'
import type { ConsentState, PrivacyRead } from '#core'

let writeFault: { before: string | null | undefined } | undefined
let lastObserved: string | null | undefined
export const PRIVACY_RECORD = 'corlex_privacy_v1'
export const SCOPE_PREFIX = 'corlex_scope_v1:'
export const LEGACY_KEYS = [
  'corlex_aid',
  'corlex_uid',
  'corlex_consent',
  'corlex_queue',
  'corlex_cfg',
  'corlex_session',
  'corlex_exp',
  'corlex_err',
]
export const choice = (value: unknown): ConsentState | undefined =>
  value === 'granted' || value === 'denied' || value === 'pending' ? value : undefined

export function readPrivacy(): PrivacyRead {
  try {
    const raw = localStorage.getItem(PRIVACY_RECORD)
    lastObserved = raw
    if (writeFault?.before === raw) return { kind: 'unavailable' }
    if (raw === null) return { kind: 'missing' }
    if (raw.length > 256) return { kind: 'unavailable' }
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object') return { kind: 'unavailable' }
    const record = value as Record<string, unknown>
    const state = choice(record.state),
      generation = record.generation
    // Never reuse an untrusted old grant, but observe a changed external denial/pending fence.
    if (
      !state ||
      typeof generation !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(generation) ||
      (writeFault && writeFault.before === undefined && state === 'granted')
    )
      return { kind: 'unavailable' }
    writeFault = undefined
    return { kind: 'valid', generation, state }
  } catch {
    return { kind: 'unavailable' }
  }
}
export function writePrivacy(state: ConsentState, generation = uuid()): PrivacyRead {
  let previous = lastObserved
  try {
    previous = localStorage.getItem(PRIVACY_RECORD)
    const value = JSON.stringify({ generation, state })
    localStorage.setItem(PRIVACY_RECORD, value)
    if (localStorage.getItem(PRIVACY_RECORD) !== value) throw new Error()
    writeFault = undefined
    lastObserved = value
    return { kind: 'valid', generation, state }
  } catch {
    writeFault = { before: previous }
    return { kind: 'unavailable' }
  }
}
export function samePrivacy(a: PrivacyRead, b: PrivacyRead): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== 'valid' ||
      (b.kind === 'valid' && a.generation === b.generation && a.state === b.state))
  )
}
/** A legacy refusal survives migration; unbound telemetry and identity never do. */
export function legacyChoice(): ConsentState | undefined {
  let previous: ConsentState | undefined
  try {
    previous = choice(localStorage.getItem('corlex_consent'))
  } catch {
    return 'pending'
  }
  return previous === 'denied' || previous === 'pending' ? previous : undefined
}
export function discardLegacy(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      /* no host rows */
    }
    try {
      document.cookie = `${key}=; max-age=0; path=/`
    } catch {
      /* cookies unavailable */
    }
  }
}

export function wipeScopes(): void {
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      const area = globalThis[storage]
      const own = Array.from({ length: area.length }, (_, i) => area.key(i)).filter(
        (k): k is string => k !== null && k.startsWith(SCOPE_PREFIX),
      )
      for (const key of own) area.removeItem(key)
    } catch {
      /* the fresh global fence still makes old rows unusable */
    }
  }
}
