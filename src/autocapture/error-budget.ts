import type { KeyValueStore } from '#core'

const KEY = 'corlex_err'
/** Different errors one browser session may report; the rest is counted nowhere and dropped. */
export const MAX_ERRORS_PER_SESSION = 20
/** A burst limit on top, for a page that throws in a loop. */
export const MAX_ERRORS_PER_MINUTE = 5
const MINUTE_MS = 60_000

/** FNV-1a: a short key of the error that does not keep its text in the session. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Decides whether an error is sent. The same error (by name, message and top frame) goes once per
 * browser session, at most `MAX_ERRORS_PER_SESSION` different ones, at most
 * `MAX_ERRORS_PER_MINUTE` in a minute. The list of what was sent lives in `sessionStorage`
 * (hashes only), so a reload does not repeat it; where storage is blocked the budget is per page.
 */
export class ErrorBudget {
  private sent: string[] | undefined
  private recent: number[] = []

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when this error may be sent; the call counts it as sent. */
  take(errorKey: string): boolean {
    const key = hash(errorKey)
    const sent = this.load()
    if (sent.includes(key) || sent.length >= MAX_ERRORS_PER_SESSION) return false
    const now = this.now()
    this.recent = this.recent.filter((at) => now - at < MINUTE_MS)
    if (this.recent.length >= MAX_ERRORS_PER_MINUTE) return false
    this.recent.push(now)
    sent.push(key)
    this.store.set(KEY, sent.join(','))
    return true
  }

  private load(): string[] {
    this.sent ??= (this.store.get(KEY) ?? '').split(',').filter((item) => item !== '')
    return this.sent
  }
}
