import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App'
import { SESSION_KEY } from '../src/auth/session'
import { session } from '../src/auth/browser-session'
import { CabinetShell } from '../src/cabinet/CabinetShell'
import { HomeSection } from '../src/cabinet/CabinetHome'
import { SectionEntry } from '../src/cabinet/SectionEntry'
import { navigate, RouteLink, useRoute } from '../src/cabinet/router'
import { sections } from '../src/cabinet/sections'
import { fixture, summary } from './home-fixtures'
import '../src/styles.css'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const root = createRoot(document.getElementById('test-root')!)
const output = document.getElementById('test-results')!
const messages: string[] = []
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function get<T extends HTMLElement>(selector: string) { const node = document.querySelector<T>(selector); assert(node, 'Missing ' + selector); return node }
async function check(name: string, run: () => Promise<void>) { await run(); messages.push('PASS ' + name); output.textContent = messages.join('\n') }
async function click(selector: string) { await act(async () => get(selector).click()) }
async function go(path: string) { await act(async () => navigate(path)) }
async function unmount() { await act(async () => root.render(null)) }
function Probe() {
  const path = useRoute()
  return createElement('div', { id: 'probe' }, path, createElement(RouteLink, { href: '/cabinet/prop', id: 'probe-link' }, 'Prop'))
}
function Placeholder() { return createElement('p', { id: 'section-rendered' }, 'Synthetic section') }
function Entries() { return createElement('div', {}, ['deposit', 'withdraw', 'exchange', 'transfer', 'verification', 'settings'].map(id => createElement(SectionEntry, { key: id, id, className: 'entry-' + id, children: id }))) }

async function run() {
  await check('push updates useRoute; browser Back and Forward update it through popstate', async () => {
    history.replaceState(null, '', '/cabinet')
    await act(async () => root.render(createElement(Probe)))
    await click('#probe-link')
    assert(get('#probe').textContent === '/cabinet/propProp', 'push did not rerender')
    async function travel(direction: 'back' | 'forward') {
      await act(async () => {
        const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
        history[direction]()
        await popped
      })
    }
    await travel('back'); assert(location.pathname === '/cabinet' && get('#probe').textContent === '/cabinetProp', 'Back failed')
    await travel('forward'); assert(get('#probe').textContent === '/cabinet/propProp', 'Forward failed')
    await unmount()
    await go('/cabinet')
  })

  const f = fixture(); await f.session.check()
  const registry = sections.map(section => section.id === 'deposit' ? { ...section, component: undefined, standalone: false } : { ...section })
  async function shell() {
    await act(async () => root.render(createElement(CabinetShell, { session: f.session, api: f.home, registry, onSessionLost() {}, onLogout() {} })))
    for (let i = 0; i < 100 && document.querySelector('[aria-busy="true"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    assert(!document.querySelector('[aria-busy="true"]'), 'Synthetic requests did not settle')
  }
  await check('unconnected entries retain Soon/MoneySoon and direct URLs replace to home', async () => {
    await shell()
    assert(get<HTMLButtonElement>('.home-rail .home-nav:nth-of-type(2)').disabled, 'Trading enabled')
    assert(get('.action-plus').getAttribute('aria-disabled') === 'true', 'MoneySoon missing')
    for (const section of registry.filter(section => !section.component)) {
      const length = history.length
      await go(section.path)
      assert(location.pathname === '/cabinet' && history.length === length + 1, 'Unavailable route was not replaced: ' + section.id)
    }
    await go('/cabinet/unknown'); assert(location.pathname === '/cabinet', 'Unknown route was not replaced')
  })
  await check('production deposit entry opens standalone and returns home using only synthetic configuration GETs', async () => {
    const entry = registry.find(section => section.id === 'deposit')!
    const originalFetch = globalThis.fetch
    let reads = 0
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      assert(url.pathname === '/paymentsystem/configuration' && (!init?.method || init.method === 'GET'), 'Unexpected deposit request')
      reads++
      return new Response('[]')
    }
    try {
      Object.assign(entry, sections.find(section => section.id === 'deposit'))
      await unmount(); await go('/cabinet'); await shell()
      await click('.action-plus')
      for (let i = 0; i < 20 && !document.querySelector('.deposit-state'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      assert(!!document.querySelector('.deposit-state') && !document.querySelector('.home-topbar') && !document.querySelector('.home-rail'), 'Standalone deposit missing')
      assert(reads === 2 && location.pathname === '/cabinet/deposit', 'Production deposit route or GET pair missing')
      await click('.deposit-back'); assert(String(location.pathname) === '/cabinet', 'Deposit Back failed')
    } finally { globalThis.fetch = originalFetch; entry.component = undefined; entry.standalone = false }
  })
  await check('one registry entry enables the existing menu link, rendering, title and active item', async () => {
    registry.find(section => section.id === 'prop')!.component = Placeholder
    await shell()
    assert(get<HTMLAnchorElement>('.home-prop a').getAttribute('href') === '/cabinet/prop', 'CTA not enabled')
    await click('.home-rail a[href="/cabinet/prop"]')
    assert(!!get('#section-rendered'), 'Component not rendered')
    assert(get('.home-rail a[href="/cabinet/prop"]').getAttribute('aria-current') === 'page', 'Active aria-current missing')
    assert(get('.home-rail a[href="/cabinet/prop"]').classList.contains('on'), 'Active class missing')
    assert(!get('.home-rail a[href="/cabinet"]').hasAttribute('aria-current'), 'Home remains active')
    assert(document.title === 'ClientCabinet — Prop Trading', 'Section title missing')
    assert(get('.home-topbar h1').textContent === 'Prop Trading', 'Header title missing')
  })
  await check('all registry destinations enable without editing navigation; profile and security use settings', async () => {
    for (const section of registry) if (section.id !== 'home') section.component = Entries
    await unmount(); await go('/cabinet'); await shell()
    for (const [id, selector] of [['deposit', '.action-plus'], ['withdraw', '.action-out'], ['exchange', '.action-more'], ['transfer', '.action-send'], ['trading', '.home-accounts .home-link']]) {
      assert(get(selector).getAttribute('href') === '/cabinet/' + id, 'Missing enabled destination ' + id)
    }
    await click('.home-user > .home-avatar')
    assert(document.querySelectorAll('.home-user-row[href="/cabinet/settings"]').length === 2, 'Profile/security not connected')
    await click('.home-user-row[href="/cabinet/settings"]')
    assert(!document.querySelector('.home-user-menu'), 'Menu survived navigation')
    for (const id of ['deposit', 'withdraw', 'exchange', 'transfer', 'verification', 'settings']) {
      await click('.entry-' + id)
      assert(location.pathname === '/cabinet/' + id, 'Route not opened: ' + id)
    }
    await unmount()
  })

  // App exercises the real session gate with a synthetic check; no credentials or network.
  const originalCheck = session.check
  const originalLogout = session.logout
  const originalRegistry = sections.map(section => ({ ...section }))
  Object.defineProperty(session, 'summary', { configurable: true, get: () => summary })
  Object.defineProperty(session, 'expiresAt', { configurable: true, get: () => Date.now() + 3600000 })
  try {
    for (const section of sections) section.component = section.id === 'home' || section.id === 'prop' ? Placeholder : undefined
    session.check = async () => true
    await check('App keeps an authenticated deep link after session check', async () => {
      await go('/cabinet/prop')
      await act(async () => root.render(createElement(App)))
      assert(String(location.pathname) === '/cabinet/prop' && !!get('#section-rendered'), 'App lost deep link')
      assert(document.title === 'ClientCabinet — Prop Trading', 'App overwrote title')
      await unmount()
    })
    await check('App normalizes unavailable and unknown deep links', async () => {
      for (const path of ['/cabinet/deposit', '/cabinet/unknown']) {
        await go(path)
        await act(async () => root.render(createElement(App)))
        assert(location.pathname === '/cabinet', 'App did not normalize ' + path)
        await unmount()
      }
    })
    await check('App sends an unauthenticated deep link to login', async () => {
      session.check = async () => false
      await go('/cabinet/prop')
      await act(async () => root.render(createElement(App)))
      assert(location.pathname === '/login' && !!document.querySelector('form'), 'Unauthenticated route not gated')
      await unmount()
    })
    await check('login in another tab restores the requested route and late logout cannot overwrite it', async () => {
      session.check = async () => false
      await go('/cabinet/prop?from=review#details')
      await act(async () => root.render(createElement(App)))
      assert(location.pathname === '/login', 'Login not shown')
      Object.defineProperty(session, 'hasSession', { configurable: true, get: () => true })
      session.check = async () => true
      await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage })))
      assert(String(location.pathname) === '/cabinet/prop' && location.search === '?from=review' && location.hash === '#details', 'Original route not restored')
      let finishLogout!: (value: boolean) => void
      session.logout = () => new Promise(resolve => { finishLogout = resolve })
      await click('.home-user > .home-avatar')
      await click('.home-user-row.danger')
      await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: SESSION_KEY, storageArea: localStorage })))
      await act(async () => finishLogout(false))
      assert(String(location.pathname) === '/cabinet/prop' && !!document.querySelector('#section-rendered'), 'Late logout replaced the newer session')
      await unmount()
    })
  } finally {
    session.logout = originalLogout
    Reflect.deleteProperty(session, 'hasSession')
    session.check = originalCheck
    Reflect.deleteProperty(session, 'summary'); Reflect.deleteProperty(session, 'expiresAt')
    sections.splice(0, sections.length, ...originalRegistry)
  }
  assert(sections[0].component === HomeSection, 'Registry not restored')
  output.dataset.status = 'passed'
}
void run().catch(error => { output.dataset.status = 'failed'; output.textContent = messages.join('\n') + '\nFAIL ' + String(error) })
