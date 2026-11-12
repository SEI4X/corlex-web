import { afterEach, expect, it } from 'vitest'
import { cleanup, mockFetch, startSdk } from './helpers'
afterEach(cleanup)
it('omits dynamic error message/name and private stack paths by default', async () => {
  const { calls } = mockFetch(),
    sdk = startSdk({ autocapture: { errors: true, pageViews: false, clicks: false, forms: false } })
  const error = new Error('alex@example.test token=synthetic_secret')
  error.name = 'alex@example.test'
  error.stack =
    'Error: alex@example.test\n at save (https://user:synthetic_secret@cdn.test/users/alex@example.test/app.js?token=synthetic_secret:4:9)'
  dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
  await sdk.flush()
  const crash = calls.flatMap((call) => call.events).find((event) => event.name === 'corlex.crash')
  expect(crash?.properties).toMatchObject({
    name: 'Error',
    message: 'Error details omitted',
    frames: [{ fn: 'save', file: 'app.js', line: 4, col: 9 }],
  })
  const text = JSON.stringify(crash)
  for (const value of ['alex@example.test', 'synthetic_secret', '/users/', 'cdn.test', 'https:'])
    expect(text).not.toContain(value)
})
it('collects bounded error messages only with explicit opt-in, keeping stack locations safe', async () => {
  const { calls } = mockFetch(),
    sdk = startSdk({
      captureErrorMessages: true,
      autocapture: { errors: true, pageViews: false, clicks: false, forms: false },
    })
  const error = new TypeError('Synthetic opted-in detail')
  error.stack = 'TypeError: detail\n at save (/Users/private-user/app.js:4:9)'
  dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
  await sdk.flush()
  const crash = calls.flatMap((call) => call.events).find((event) => event.name === 'corlex.crash')
  expect(crash?.properties).toMatchObject({
    name: 'TypeError',
    message: 'Synthetic opted-in detail',
    frames: [{ fn: 'save', file: 'app.js', line: 4, col: 9 }],
  })
  expect(JSON.stringify(crash)).not.toContain('private-user')
})
