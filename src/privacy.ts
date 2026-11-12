import { read, write } from './storage'
import type { ConsentState } from './types'

const CONSENT_KEY = 'corlex_consent'

/** Do Not Track or Global Privacy Control is switched on in the browser. */
export function browserOptedOut(): boolean {
  const nav = globalThis.navigator as Navigator & {
    globalPrivacyControl?: boolean
    msDoNotTrack?: string
  }
  const win = globalThis as { doNotTrack?: string }
  const dnt = [nav?.doNotTrack, win.doNotTrack, nav?.msDoNotTrack]
  return dnt.includes('1') || nav?.globalPrivacyControl === true
}

/** The visitor's earlier choice, if any. */
export function storedConsent(): ConsentState | null {
  const value = read('localStorage', CONSENT_KEY)
  return value === 'granted' || value === 'denied' ? value : null
}

export function saveConsent(state: 'granted' | 'denied'): void {
  write('localStorage', CONSENT_KEY, state)
}
