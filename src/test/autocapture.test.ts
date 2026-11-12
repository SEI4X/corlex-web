import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, expectProtocolValid, mockFetch, startSdk, type Call } from './helpers'
import type { WireEvent } from '../types'

beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/')
  document.body.innerHTML = ''
  document.title = 'Home'
})
afterEach(cleanup)

async function collect(calls: Call[], sdk: ReturnType<typeof startSdk>): Promise<WireEvent[]> {
  await sdk.flush()
  expectProtocolValid(calls)
  return calls.flatMap((c) => c.events)
}

describe('page views', () => {
  it('reports the first page and every SPA navigation once per URL', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    history.pushState(null, '', '/pricing')
    history.pushState(null, '', '/pricing')
    history.replaceState(null, '', '/pricing')
    await vi.advanceTimersByTimeAsync(10)
    history.pushState(null, '', '/pricing?plan=pro')
    await vi.advanceTimersByTimeAsync(10)
    history.back()
    await vi.advanceTimersByTimeAsync(10)
    const views = (await collect(calls, sdk)).filter((e) => e.name === 'page_view')
    expect(views.map((v) => v.properties['page_origin'])).toEqual(
      Array(4).fill('http://localhost:3000'),
    )
    for (const view of views) {
      expect(view.properties).not.toHaveProperty('page_path')
      expect(view.properties).not.toHaveProperty('page_url')
    }
    expect(views[1]?.properties['referrer']).toBe('http://localhost:3000')
  })

  it('does not report a hash-only change as a new page', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    history.pushState(null, '', '/#section')
    await vi.advanceTimersByTimeAsync(10)
    expect((await collect(calls, sdk)).filter((e) => e.name === 'page_view')).toHaveLength(1)
  })

  it('stops patching history after destroy()', () => {
    const original = history.pushState
    const sdk = startSdk({ autocapture: true })
    expect(history.pushState).not.toBe(original)
    sdk.destroy()
    expect(history.pushState).toBe(original)
  })

  it('carries screen and viewport sizes on page_view only', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    sdk.track('other')
    const events = await collect(calls, sdk)
    expect(events[0]?.properties).toHaveProperty('viewport_width')
    expect(events[1]?.properties).not.toHaveProperty('viewport_width')
  })
})

describe('UTM and referrer', () => {
  it('parses UTM tags, keeps them for the session and attaches them to events', async () => {
    history.replaceState(null, '', '/?utm_source=tg&utm_medium=post&utm_campaign=launch&x=1')
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    history.pushState(null, '', '/pricing')
    await vi.advanceTimersByTimeAsync(10)
    sdk.track('buy')
    const events = await collect(calls, sdk)
    for (const event of events) {
      expect(event.properties).toMatchObject({
        utm_source: 'tg',
        utm_medium: 'post',
        utm_campaign: 'launch',
      })
      expect(event.properties).not.toHaveProperty('x')
    }
    // A reload without tags in the URL keeps the session's tags.
    history.replaceState(null, '', '/other')
    const again = mockFetch()
    const next = startSdk({ autocapture: true })
    expect((await collect(again.calls, next))[0]?.properties['utm_source']).toBe('tg')
  })

  it('records an external referrer once per session', async () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://t.me/channel/42?x=secret')
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    const [view] = await collect(calls, sdk)
    expect(view?.properties['referrer']).toBe('https://t.me')
    expect(view?.properties['initial_referrer']).toBe('https://t.me')
    expect(JSON.stringify(view)).not.toContain('secret')
  })

  it('never sends a query string: a reset link leaks no token or email, UTM stays', async () => {
    history.replaceState(null, '', '/reset?token=abc123&email=a@b.c&utm_source=x&sid=s3cret')
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'https://mail.test/inbox?code=oauth9&email=a@b.c',
    )
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true })
    sdk.track('custom')
    const events = await collect(calls, sdk)
    const json = JSON.stringify(events)
    for (const secret of ['abc123', 'a@b.c', 's3cret', 'oauth9', 'token', 'email', 'sid']) {
      expect(json).not.toContain(secret)
    }
    expect(json).not.toContain('?')
    for (const event of events) {
      expect(event.properties).toMatchObject({
        utm_source: 'x',
        page_origin: 'http://localhost:3000',
      })
    }
    expect(events[0]?.properties['referrer']).toBe('https://mail.test')
  })

  it('keeps ad click ids and only the extra params the site owner lists', async () => {
    history.replaceState(null, '', '/?gclid=g1&fbclid=f1&ref=partner&token=zzz')
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: true, captureQueryParams: ['ref'] })
    const [view] = await collect(calls, sdk)
    expect(view?.properties).toMatchObject({ gclid: 'g1', fbclid: 'f1', ref: 'partner' })
    expect(JSON.stringify(view)).not.toContain('zzz')
  })
})

describe('clicks', () => {
  function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('captures buttons, links, role=button and submit inputs without input values', async () => {
    document.body.innerHTML = `
      <button id="buy" class="btn primary">  Buy   now </button>
      <a href="https://shop.test/cart?token=secret#frag"><span id="inner">Cart</span></a>
      <div role="button" id="rb">Toggle</div>
      <input type="submit" value="Send my password hunter2" id="sub">
      <input type="text" id="name" value="Alice Smith">
      <div role="button" id="wrapper">Edit <textarea>secret note</textarea></div>
      <p id="plain">not clickable</p>`
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: { clicks: true, pageViews: false } })
    for (const id of ['buy', 'inner', 'rb', 'sub', 'name', 'wrapper', 'plain']) {
      click(document.getElementById(id) as Element)
    }
    const clicks = await collect(calls, sdk)
    expect(clicks.every((c) => c.name === 'click')).toBe(true)
    expect(clicks).toHaveLength(5)
    expect(clicks[0]?.properties).toMatchObject({
      tag: 'button',
    })
    expect(clicks[1]?.properties).toMatchObject({
      tag: 'a',
      href_origin: 'https://shop.test',
    })
    expect(clicks[3]?.properties).toMatchObject({ tag: 'input' })
    const json = JSON.stringify(clicks)
    for (const secret of ['hunter2', 'Alice', 'secret note', 'token=secret']) {
      expect(json).not.toContain(secret)
    }
  })

  it('skips ignored elements and bounds explicitly supplied labels', async () => {
    document.body.innerHTML = `
      <div data-corlex-ignore><button id="hidden">Private</button></div>
      <button id="long" data-corlex-action="${'x'.repeat(500)}" class="c1 c2 c3 c4 c5 c6 c7">${'x'.repeat(500)}</button>`
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: { clicks: true, pageViews: false } })
    click(document.getElementById('hidden') as Element)
    click(document.getElementById('long') as Element)
    const clicks = await collect(calls, sdk)
    expect(clicks).toHaveLength(1)
    expect((clicks[0]?.properties['action'] as string).length).toBe(128)
    expect(clicks[0]?.properties).not.toHaveProperty('classes')
    expect(clicks[0]?.properties).not.toHaveProperty('text')
  })
})

describe('forms', () => {
  it('reports the form and its field count, never the values', async () => {
    document.body.innerHTML = `
      <form id="signup" name="signup" action="/join?ref=ref-xq-77" method="POST">
        <input name="email" value="alice@example.com">
        <input name="password" type="password" value="hunter2">
        <textarea name="bio">my life</textarea>
        <input type="hidden" name="csrf" value="csrf-zq-77">
        <button type="submit">Join</button>
      </form>`
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: { forms: true, pageViews: false } })
    const form = document.getElementById('signup') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    const events = await collect(calls, sdk)
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('form_submit')
    expect(events[0]?.properties).toMatchObject({
      form_origin: 'http://localhost:3000',
      form_method: 'post',
      field_count: 3,
    })
    const json = JSON.stringify(events)
    // Values that cannot occur by chance in the random ids of the payload (hex and base62).
    for (const secret of ['alice@example.com', 'hunter2', 'my life', 'ref-xq-77', 'csrf-zq-77']) {
      expect(json).not.toContain(secret)
    }
  })
})

describe('autocapture off', () => {
  it('does nothing with autocapture off', async () => {
    const { calls } = mockFetch()
    const sdk = startSdk({ autocapture: false })
    dispatchEvent(new ErrorEvent('error', { message: 'x' }))
    document.body.innerHTML = '<button id="b">b</button>'
    ;(document.getElementById('b') as HTMLElement).click()
    expect(await collect(calls, sdk)).toHaveLength(0)
  })
})
