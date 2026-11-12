import {
  EVENT_CRASH,
  errorDetails,
  safeErrorReport,
  uuid,
  type JsFrame,
  type KeyValueStore,
  type PlatformHost,
  type Properties,
} from '#core'
import { ErrorBudget } from './error-budget'

type Source = 'global_handler' | 'unhandled_rejection'

interface Report {
  name: string
  message: string
  frames: JsFrame[]
  source: Source
}

function fromErrorEvent(e: ErrorEvent, detailed: boolean): Report {
  const report = errorDetails(e.error, detailed, e.message)
  if (report.frames.length === 0 && e.filename) {
    report.frames = safeErrorReport({
      frames: [{ fn: 'anonymous', file: e.filename, line: e.lineno, col: e.colno }],
    }).frames
  }
  return { ...report, source: 'global_handler' }
}
function fromRejection(reason: unknown, detailed: boolean): Report {
  const report = errorDetails(reason, detailed)
  if (!(reason instanceof Error)) report.name = 'UnhandledRejection'
  return { ...report, source: 'unhandled_rejection' }
}

/** The properties of a `corlex.crash` event for a JS error of a page. */
function crashProperties(report: Report, crashId: string): Properties {
  return {
    crash_id: crashId,
    kind: 'js',
    // A page survives an uncaught error: it is an error, not a dead process.
    fatal: false,
    name: report.name,
    message: report.message,
    source: report.source,
    frames: report.frames as unknown as Properties[string],
    symbolicated: false,
  }
}

/**
 * Uncaught errors and unhandled promise rejections as `corlex.crash` (kind `js`), the same event
 * the React Native SDK sends, so the backend groups them by one fingerprint. `event_id` is the
 * `crash_id`. Listeners are added, never assigned, so the page's own `onerror` keeps working.
 *
 * Volume is bounded per session (`ErrorBudget`): the same error is sent once, and a page that
 * throws in a loop cannot flood ingest. What leaves the page: a known error type, generic message (details only by explicit opt-in),
 * and safe bundle basenames/function positions. No DOM, no storage, no request bodies.
 */
export function startErrors(
  host: Pick<PlatformHost, 'capture' | 'consent'>,
  store: KeyValueStore,
  detailed = false,
): () => void {
  // Nothing is written to the browser before consent; until then the budget lives in memory.
  const guarded: KeyValueStore = {
    get: (key) => store.get(key),
    set: (key, value) => host.consent() === 'granted' && store.set(key, value),
    remove: (key) => store.remove(key),
  }
  const budget = new ErrorBudget(guarded)
  const send = (report: Report): void => {
    const top = report.frames[0]
    const key = `${report.name}|${report.message}|${top?.fn ?? ''}|${top?.file ?? ''}|${top?.line ?? ''}`
    if (!budget.take(key)) return
    const crashId = uuid()
    host.capture(EVENT_CRASH, crashProperties(report, crashId), { eventId: crashId })
  }
  const onError = (e: ErrorEvent): void => send(fromErrorEvent(e, detailed))
  const onRejection = (e: Event): void =>
    send(fromRejection((e as PromiseRejectionEvent).reason, detailed))
  addEventListener('error', onError)
  addEventListener('unhandledrejection', onRejection)
  return () => {
    removeEventListener('error', onError)
    removeEventListener('unhandledrejection', onRejection)
  }
}
