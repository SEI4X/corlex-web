import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, mockFetch, startSdk } from './helpers'

afterEach(() => {
  document.documentElement.removeAttribute('data-corlex-page')
  cleanup()
})
it('does not automatically copy personal DOM text, identifiers, paths, form attributes or legacy session fields', async () => {
  const marker = 'alex@example.test'
  history.replaceState(null, '', '/users/' + marker)
  document.title = marker
  document.body.innerHTML = `<a id="${marker}" class="${marker}" href="https://ref.test/users/${marker}">${marker}</a><form id="${marker}" name="${marker}" action="/users/${marker}" method="${marker}"><input name="email" value="${marker}"></form>`
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://ref.test/users/' + marker)
  sessionStorage.setItem(
    'corlex_session',
    JSON.stringify({
      initial_referrer: 'https://ref.test/users/' + marker,
      page_title: marker,
      arbitrary: marker,
    }),
  )
  const { calls } = mockFetch(),
    sdk = startSdk({ autocapture: true })
  document.querySelector('a')?.addEventListener('click', (event) => event.preventDefault())
  document
    .querySelector('a')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  document
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await sdk.flush()
  const events = calls.flatMap((call) => call.events),
    json = JSON.stringify(events)
  expect(json).not.toContain(marker)
  expect(json).not.toContain('/users/')
  expect(json).not.toContain('safe_campaign')
  for (const event of events) {
    expect(event.properties).toMatchObject({
      page_origin: 'http://localhost:3000',
      initial_referrer: 'https://ref.test',
    })
    for (const key of [
      'page_url',
      'page_path',
      'page_title',
      'text',
      'element_id',
      'classes',
      'form_id',
      'form_name',
      'form_action',
      'arbitrary',
    ])
      expect(event.properties).not.toHaveProperty(key)
  }
})
it('uses only explicit fixed page/action labels and preserves explicit track properties', async () => {
  document.documentElement.setAttribute('data-corlex-page', '/expenses/:id')
  document.body.innerHTML = '<button data-corlex-action="save_expense">alex@example.test</button>'
  const { calls } = mockFetch(),
    sdk = startSdk({ autocapture: true })
  document.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  sdk.track('explicit', { contact: 'intentional@example.test' })
  await sdk.flush()
  const events = calls.flatMap((call) => call.events)
  expect(events[0]?.properties).toMatchObject({ page_path: '/expenses/:id' })
  expect(events.find((event) => event.name === 'click')?.properties).toMatchObject({
    action: 'save_expense',
    tag: 'button',
  })
  expect(events.find((event) => event.name === 'explicit')?.properties).toMatchObject({
    contact: 'intentional@example.test',
  })
  expect(JSON.stringify(events)).not.toContain('alex@example.test')
})
