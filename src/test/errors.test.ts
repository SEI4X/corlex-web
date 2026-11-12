import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ERRORS_PER_MINUTE, MAX_ERRORS_PER_SESSION } from '../autocapture/error-budget'
import { cleanup, expectProtocolValid, mockFetch, startSdk, type Call } from './helpers'
import type { WireEvent } from '../types'

beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/')
})
afterEach(cleanup)

async function collect(calls: Call[], sdk: ReturnType<typeof startSdk>): Promise<WireEvent[]> {
  await sdk.flush()
  expectProtocolValid(calls)
  return calls.flatMap((c) => c.events)
}

const start = () => startSdk({ autocapture: { errors: true, pageViews: false, clicks: false } })

function throwError(
  error: Error,
  where = { filename: 'https://x.test/app.js', lineno: 10, colno: 5 },
) {
  dispatchEvent(new ErrorEvent('error', { message: error.message, ...where, error }))
}

describe('JS errors as corlex.crash', () => {
  it('reports an uncaught error with name, parsed frames and the crash id as event id', async () => {
    const { calls } = mockFetch()
    const sdk = start()
    const error = new TypeError('x is undefined')
    error.stack = [
      'TypeError: x is undefined',
      '    at summarize (https://x.test/assets/app.3f2a.js?v=2:10:5)',
      '    at https://x.test/assets/app.3f2a.js:20:1',
    ].join('\n')
    throwError(error)
    const [event] = await collect(calls, sdk)
    expect(event?.name).toBe('corlex.crash')
    expect(event?.properties).toMatchObject({
      kind: 'js',
      fatal: false,
      name: 'TypeError',
      message: 'Error details omitted',
      source: 'global_handler',
      symbolicated: false,
      frames: [
        { fn: 'summarize', file: 'app.3f2a.js', line: 10, col: 5 },
        { fn: 'anonymous', file: 'app.3f2a.js', line: 20, col: 1 },
      ],
    })
    expect(event?.event_id).toBe(event?.properties['crash_id'])
  })

  it('reads a Firefox-style stack too', async () => {
    const { calls } = mockFetch()
    const sdk = start()
    const error = new Error('boom')
    error.stack = 'summarize@https://x.test/app.js:10:15\n@https://x.test/app.js:20:5'
    throwError(error)
    const [event] = await collect(calls, sdk)
    expect(event?.properties['frames']).toEqual([
      { fn: 'summarize', file: 'app.js', line: 10, col: 15 },
      { fn: 'anonymous', file: 'app.js', line: 20, col: 5 },
    ])
  })

  it('keeps the one frame of a stackless error and drops the query string of its file', async () => {
    const { calls } = mockFetch()
    const sdk = start()
    dispatchEvent(
      new ErrorEvent('error', {
        message: 'Script error.',
        filename: 'https://cdn.test/lib.js?token=secret',
        lineno: 3,
        colno: 9,
      }),
    )
    const [event] = await collect(calls, sdk)
    expect(event?.properties['frames']).toEqual([
      { fn: 'anonymous', file: 'lib.js', line: 3, col: 9 },
    ])
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('reports an unhandled rejection, and a non-error reason without its content', async () => {
    const { calls } = mockFetch()
    const sdk = start()
    const reason = new RangeError('rejected')
    reason.stack = 'RangeError: rejected\n    at load (https://x.test/app.js:1:1)'
    dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
    dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: { secret: 'a@b.c' } }))
    const events = await collect(calls, sdk)
    expect(events.map((e) => e.properties['name'])).toEqual(['RangeError', 'UnhandledRejection'])
    expect(events[0]?.properties).toMatchObject({
      source: 'unhandled_rejection',
      message: 'Error details omitted',
    })
    expect(events[1]?.properties).toMatchObject({
      message: 'Error details omitted',
      frames: [],
    })
    expect(JSON.stringify(events)).not.toContain('a@b.c')
  })

  it('strips query strings from URLs in the message and caps its length', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({
      captureErrorMessages: true,
      autocapture: { errors: true, pageViews: false, clicks: false },
    })
    throwError(new Error(`GET https://api.test/me?token=abc failed ${'z'.repeat(2000)}`))
    const [event] = await collect(calls, sdk)
    const message = String(event?.properties['message'])
    expect(message.startsWith('GET https://api.test/me failed')).toBe(true)
    expect(message).not.toContain('token=abc')
    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(512)
  })

  it('sends the same error once per session, even after a reload', async () => {
    const { calls } = mockFetch()
    const first = start()
    const same = new Error('same')
    for (let i = 0; i < 5; i += 1) throwError(same)
    expect(await collect(calls, first)).toHaveLength(1)
    first.destroy()
    const second = start()
    throwError(same)
    expect((await collect(calls, second)).length).toBe(1)
  })

  it('caps the errors per minute and per session', async () => {
    const { calls } = mockFetch()
    const sdk = start()
    const unique = (n: number) => {
      const error = new Error('same')
      error.stack = `Error\n at load (app.js:${n + 1}:1)`
      return error
    }
    for (let i = 0; i < 12; i += 1) throwError(unique(i))
    expect(await collect(calls, sdk)).toHaveLength(MAX_ERRORS_PER_MINUTE)
    for (let minute = 0; minute < 10; minute += 1) {
      await vi.advanceTimersByTimeAsync(61_000)
      for (let i = 0; i < 5; i += 1) throwError(unique(12 + minute * 5 + i))
    }
    const total = (await collect(calls, sdk)).length
    expect(total).toBe(MAX_ERRORS_PER_SESSION)
  })

  it('writes nothing to the browser before consent', async () => {
    mockFetch()
    const sdk = startSdk({
      autocapture: { errors: true, pageViews: false, clicks: false },
      consent: 'pending',
    })
    throwError(new Error('early'))
    expect(sessionStorage.getItem('corlex_err')).toBeNull()
    sdk.destroy()
  })

  it('does not report when the errors part is off (opt-out)', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: { errors: false, pageViews: false, clicks: false } })
    dispatchEvent(new ErrorEvent('error', { message: 'x' }))
    expect(await collect(calls, sdk)).toHaveLength(0)
  })
})
