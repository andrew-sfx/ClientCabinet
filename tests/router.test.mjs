import test from 'node:test'
import assert from 'node:assert/strict'
import { navigate, RouteLink } from '../src/cabinet/router.ts'

test('router pushes/replaces history and notifies subscribers', () => {
  const target = new EventTarget()
  const calls = []
  let notifications = 0
  target.addEventListener('cabinet:navigate', () => notifications++)
  const original = globalThis.window
  globalThis.window = Object.assign(target, {
    location: new URL('https://cabinet.example.invalid/cabinet'),
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _unused, url) => calls.push([method, String(url)])])),
  })
  try {
    navigate('/cabinet/prop')
    navigate('/cabinet', true)
    assert.deepEqual(calls.map(call => call[0]), ['pushState', 'replaceState'])
    assert.equal(calls[0][1], 'https://cabinet.example.invalid/cabinet/prop')
    assert.equal(notifications, 2)
    assert.throws(() => navigate('https://other.example.invalid/'), /same origin/)
    assert.equal(calls.length, 2)
  } finally { globalThis.window = original }
})

test('link preserves href, intercepts a plain click and respects native click semantics', () => {
  let pushes = 0
  const original = globalThis.window
  globalThis.window = {
    location: new URL('https://cabinet.example.invalid/cabinet'),
    history: { pushState: () => pushes++ }, dispatchEvent() {},
  }
  try {
    function click(props = {}, options = {}) {
      const link = RouteLink({ href: '/cabinet/prop', ...props })
      const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...options }
      link.props.onClick(event)
      return { link, event }
    }
    const ordinary = click()
    assert.equal(ordinary.link.props.href, '/cabinet/prop')
    assert.equal(ordinary.event.defaultPrevented, true)
    assert.equal(pushes, 1)
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) click({}, options)
    for (const props of [{ target: '_blank' }, { download: '' }, { href: 'https://other.example.invalid/' }, { onClick: event => event.preventDefault() }]) click(props)
    assert.equal(pushes, 1)
    click({ target: '_self' })
    assert.equal(pushes, 2)
  } finally { globalThis.window = original }
})
