import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CurrencySelectionSuperseded, balanceView, dateLabel } from '../src/cabinet/api'
import { BalanceMenu } from '../src/cabinet/BalanceMenu'
import { CabinetShell as CabinetHome } from '../src/cabinet/CabinetShell'
import { fixture, operations } from './home-fixtures'
import '../src/styles.css'

// Dev-only page. Synthetic transport and memory storage; no real API or browser session.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const root = createRoot(document.getElementById('test-root')!)
const output = document.getElementById('test-results')!
const messages: string[] = []
let key = 0, lost = 0, loggedOut = 0
let current = fixture()
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function get<T extends HTMLElement>(selector: string) { const found = document.querySelector<T>(selector); assert(found, 'Missing: ' + selector); return found }
const mobile = matchMedia('(max-width: 600px)').matches
const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(element => element.getClientRects().length > 0)
const operationCount = mobile ? 3 : 5
const onLost = () => { lost++ }
const onLogout = () => { loggedOut++ }
async function mount(mode = 'data', history?: unknown[]) {
  current = fixture(mode, mode === 'long' ? operations.map(operation => ({ ...operation, amount: 12345678.12345678, currency: { code: 'BTC', precision: 8 } })) : history); lost = 0; loggedOut = 0
  if (mode === 'superseded') current.home.selectCurrency = async () => { throw new CurrencySelectionSuperseded() }
  if (mode === 'zero') current.state.balances = current.state.balances.map(b => ({ ...b, available: 0, reserved: 0 }))
  if (mode === 'long') current.state.balances = [{ available: 12345678.12345678, reserved: 0, currency: { code: 'BTC', precision: 8 }, currencyRate: 1, defaultDomainCurrencyCode: 'BTC' }]
  if (mode === 'many') current.state.balances = ['USD', 'EUR', 'JPY', 'CHF', 'RUB', 'CNY', 'AUD', 'CAD', 'BTC', 'ETH', 'USDT', 'USDC', 'LTC', 'XRP', 'SOL', 'ADA', 'DOT', 'DOGE', 'BCH', 'ETC'].map((code, i) => ({ available: i < 8 ? 100 - i : i === 8 ? 0.0154 : 0, reserved: 0, currency: { code, precision: i < 8 ? 2 : 8 }, currencyRate: 1, defaultDomainCurrencyCode: 'USD' }))
  await current.session.check()
  await act(async () => root.render(createElement(CabinetHome, { key: ++key, session: current.session, api: current.home, onSessionLost: onLost, onLogout })))
  if (mode !== 'loading') await settle()
}
async function settle() {
  for (let i = 0; i < 100 && lost === 0 && document.querySelector('[aria-busy="true"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  assert(lost > 0 || !document.querySelector('[aria-busy="true"]'), 'Requests did not settle')
}
async function settleClose() {
  const nodes = [...document.querySelectorAll('.is-closing, .home-panel-closing .home-panel-slot')]
  await act(async () => { await Promise.allSettled(nodes.flatMap(node => node.getAnimations()).map(animation => animation.finished)) })
}
async function click(selector: string) { await act(async () => get(selector).click()); await settleClose(); if (current.state.mode !== 'loading') await settle() }
async function press(target: HTMLElement, key: string, shiftKey = false) { await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))); await settleClose() }
async function check(name: string, fn: () => Promise<void>) { await fn(); messages.push('PASS ' + name); output.textContent = messages.join('\n') }

async function run() {
  await check('currency menu without a default focuses the first option on the second level', async () => {
    await mount('no-default')
    assert(current.state.balances.every(balance => balance.defaultDomainCurrencyCode === undefined) && !current.state.setting, 'Fixture has a default')
    await click('.home-balance-trigger')
    get('.home-balance-setting').focus()
    await click('.home-balance-setting')
    assert(!document.querySelector('[role="option"][aria-selected="true"]'), 'Invented selected currency')
    assert(document.activeElement === get('[role="option"]'), 'First option did not receive focus')
  })
  await check('currency menu without options focuses the back button', async () => {
    await act(async () => root.render(createElement(BalanceMenu, { view: balanceView([], undefined, []), busy: false, chooseRow: () => {}, chooseTotal: async () => {}, close: () => {}, trigger: null })))
    await click('.home-balance-setting')
    assert(!document.querySelector('[role="option"]'), 'Unexpected currency option')
    assert(document.activeElement === get('.home-balance-back'), 'Back button did not receive focus')
  })
  await check('superseded currency selection stays silent in MainBalance', async () => {
    await mount('superseded'); await click('.home-balance-trigger'); await click('.home-balance-setting')
    await click('.home-total-option[aria-selected="false"]')
    assert(!document.querySelector('.home-balance [role="alert"]'), 'Superseded choice reported a save error')
    assert(get('.home-balance-amount b').textContent === '11 915,00 USD', 'Superseded choice changed the balance')
  })
  await check('unknown currency BYN keeps an accessible name on both menu levels', async () => {
    await mount('unknown-currency'); await click('.home-balance-trigger')
    assert(get('.home-balance-option:nth-of-type(2) .home-balance-option-name').textContent?.includes('BYN'), 'First level lacks BYN')
    await click('.home-balance-setting')
    assert(get('.home-total-option .home-balance-option-name').textContent === 'BYN', 'Second level lacks BYN')
  })
  await check('new client: empty balance/operations/accounts with no invented currency', async () => { await mount('new'); assert(document.body.textContent?.includes('Операций пока нет'), 'No empty operations'); assert(document.body.textContent?.includes('Торговых счетов нет'), 'No empty accounts'); assert(get('.home-balance-amount').textContent === '0', 'Invented currency') })
  await check('data: independent successful blocks and cached summary', async () => { await mount(); assert(visible('.home-table tbody tr').length === operationCount, 'History rows'); assert(document.querySelectorAll('.home-accounts .home-list-row').length === 2, 'Real accounts'); assert(current.state.calls.filter(c => c.path === '/user/account/summary').length === 1, 'Repeated summary'); assert(!document.body.textContent?.includes('TEST-DEMO'), 'Demo leaked'); assert(get('.home-inactive').textContent?.includes('Неактивен'), 'Inactive account') })
  await check('H1: raw operation/payment codes choose the same icon in rows and details, unknown codes retain sign fallback', async () => {
    // Accepted icon paths; compare the rendered SVG, including on the mobile list.
    const paths = { in: 'M10 4v11M6 11l4 4 4-4', out: 'M10 15V4M6 8l4-4 4 4M4 16h12', send: 'M4 10h11M11 6l4 4-4 4', exch: 'M4 7h11l-3-3M16 13H5l3 3', list: 'M6 6h9M6 10h9M6 14h6M3.5 6h.01M3.5 10h.01M3.5 14h.01' }
    const cases: [string | undefined, string | undefined, boolean | undefined, keyof typeof paths][] = [
      ['Add', undefined, false, 'in'], ['Withdraw', undefined, true, 'out'],
      ['Add', 'Transfer', true, 'send'], ['Withdraw', 'Transfer', false, 'send'],
      ['Add', 'Exchange', true, 'exch'], ['Withdraw', 'Exchange', false, 'exch'],
      ['Server new type', 'Server new payment', true, 'in'], ['Server new type', 'Server new payment', false, 'out'],
      ['Server new type', 'Server new payment', undefined, 'list'], [undefined, undefined, undefined, 'list'],
      ['Перевод', 'Обмен', false, 'out'], ['Exchange', undefined, true, 'in'],
    ]
    for (const [typeCode, paymentTypeCode, positive, icon] of cases) {
      await mount('data', [{ ...operations[0], type: { name: typeCode, balanceOperationType: { isPositive: positive } }, paymentOptionType: { type: { name: paymentTypeCode }, option: { name: 'Обмен' } } }])
      const row = get('.home-table tbody tr'), expected = paths[icon], description = `${typeCode}/${paymentTypeCode}/${positive}`
      assert(row.querySelector('svg path')?.getAttribute('d') === expected, 'Row icon: ' + description)
      await click('.home-table tbody tr')
      assert(get('.home-panel-hero svg path').getAttribute('d') === expected, 'Detail icon: ' + description)
      await press(document.activeElement as HTMLElement, 'Escape')
    }
    await mount()
  })
  await check('Typography: local Inter, R6, buttons, columns and statuses use the accepted weights and colors', async () => {
    await mount(); await document.fonts.ready
    const style = (selector: string) => getComputedStyle(get(selector))
    const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    assert(style('.home-shell').fontFamily.startsWith('Inter') || style('.home-shell').fontFamily.startsWith('"Inter"'), 'Wrong family')
    assert(style('.home-pill.small').fontWeight === '500' && style('.home-pill.small').fontSize === '14px', 'Pill type')
    assert(style('.home-balance-meta').fontSize === '15px' && style('.home-balance-meta').fontWeight === '500', 'R6 type')
    assert(style('.home-table th').fontSize === '14px' && style('.home-table th').fontWeight === '400', 'Column type')
    assert(style('.home-status').fontSize === '14px' && style('.home-status').fontWeight === '400', 'Status type')
    assert(style('.home-status.ok').color === 'rgb(255, 255, 255)' && style('.home-status.wait').color === token('--ink-muted'), 'Status colors')
    assert(style('.home-status.bad').color === 'rgb(255, 155, 143)', 'Error color')
  })
  await check('H9: ordinary and 8+8 BTC balances keep the fraction intact, fit the viewport and retain the R6 separator', async () => {
    await document.fonts.ready
    for (const mode of ['data', 'long']) {
      await mount(mode)
      const amount = get('.home-balance-amount'), number = get('.home-balance-number')
      const integer = document.createRange(), fraction = document.createRange()
      integer.selectNodeContents(number.firstChild!)
      fraction.selectNodeContents(get('.home-balance-number small'))
      const whole = integer.getBoundingClientRect(), decimal = fraction.getBoundingClientRect()
      assert(Math.max(whole.top, decimal.top) < Math.min(whole.bottom, decimal.bottom), 'Fraction wrapped away from integer')
      assert(number.getBoundingClientRect().width <= amount.clientWidth, 'Number exceeds available width')
      const currency = get('.home-balance-currency').getBoundingClientRect(), trigger = get('.home-balance-trigger').getBoundingClientRect()
      assert(trigger.top >= currency.top && trigger.bottom <= currency.bottom && trigger.right <= currency.right, 'Chevron left currency group')
      assert(document.documentElement.scrollWidth <= innerWidth, 'Long balance overflows viewport')
      const size = getComputedStyle(get('.home-balance-amount b'))
      if (amount.hasAttribute('data-compact')) assert(size.fontSize === '24px' && size.lineHeight === '32px' && getComputedStyle(get('.home-balance-number small')).fontSize === '16px', 'Missing compact fallback')
      else assert(size.fontSize === (innerWidth <= 360 ? '28px' : '36px'), 'Ordinary balance was reduced')
      const available = get('.home-balance-meta > span:first-child'), reserved = get('.home-balance-meta > span:nth-child(2)')
      assert(available.textContent?.endsWith(' ·') && reserved.textContent?.startsWith('Заблокировано'), 'Separator starts second part')
      const money = available.querySelector<HTMLElement>('.home-money')!
      const range = document.createRange(); range.selectNodeContents(money)
      const pieces = [...range.getClientRects()]
      assert(Math.max(...pieces.map(r => r.top)) < Math.min(...pieces.map(r => r.bottom)), 'Separator left available amount')
      assert(money.getBoundingClientRect().right <= amount.getBoundingClientRect().right, 'R6 amount overflows')
    }
    await mount()
  })
  await check('BV-1: total collapsed, no old details/chips, zero permits currency selection', async () => {
    await mount('zero'); await click('.home-balance-trigger'); await click('.home-balance-setting'); assert(document.querySelectorAll('.home-total-option').length === 3, 'Zero currencies unavailable'); await click('.home-balance-close'); await settleClose()
    await mount(); assert(!document.querySelector('.home-balance-menu, .home-details-toggle, .home-currency-trigger'), 'Old controls remain')
    assert(get('.home-balance-trigger').getAttribute('aria-expanded') === 'false', 'Expanded by default')
    assert(get('.home-balance-amount b').textContent === '11 915,00 USD', 'Partial total')
    assert(get('.home-balance-meta > span:first-child').textContent?.endsWith(' USD ·') && get('.home-balance-meta > span:nth-child(2)').textContent === 'Заблокировано 250 USD', 'R6 currency codes and separator')
    assert(get('.home-table tbody tr').textContent?.includes(dateLabel(operations[0].created)), 'Relative row date')
  })
  await check('BV-1: partial rates, order, excluded note, local row selection and total return', async () => {
    assert(get('.home-balance-caption .home-warning').title.includes('GBP'), 'Missing caption warning')
    await click('.home-balance-trigger')
    const options = [...document.querySelectorAll<HTMLElement>('.home-balance-option')]
    assert(options.length === 4 && options[0].getAttribute('aria-selected') === 'true', 'Total selection')
    assert(options.map(option => option.querySelector('.home-balance-option-name')?.childNodes[0]?.textContent).slice(1).join(',') === 'Доллар США,Евро,Фунт стерлингов', 'Currency order')
    assert(options[0].textContent?.includes('Валют: 3 · GBP не учтён'), 'Total exclusion note')
    assert(options[2].textContent?.includes('≈ 3 465 USD'), 'EUR approximation')
    assert(options[3].textContent?.includes('⚠ нет курса к USD'), 'Missing rate note')
    const before = current.state.calls.length
    await click('.home-balance-option:nth-of-type(3)')
    assert(!document.querySelector('.home-balance-menu') && get('.home-balance-amount b').textContent === '3 150,00 EUR', 'Local selection')
    assert(get('.home-balance-caption').textContent === 'Основной счёт · Евро' && !document.querySelector('.home-balance-caption .home-warning'), 'Selected currency caption')
    assert(current.state.calls.length === before && visible('.home-table tbody tr').length === operationCount, 'Row selection called API or filtered history')
    assert(document.activeElement === get('.home-balance-trigger'), 'Row return focus')
    await click('.home-balance-trigger'); assert(document.activeElement?.textContent?.includes('Евро'), 'Selected row focus')
    await click('.home-balance-option'); assert(get('.home-balance-amount b').textContent === '11 915,00 USD', 'Total return')
    await mount(); assert(get('.home-balance-caption').textContent?.startsWith('Основной счёт') && !get('.home-balance-caption').textContent?.includes('Евро'), 'Local choice persisted on remount')
  })
  await check('missing default currency: no invented total; chooser remains available', async () => {
    await mount('missing-default'); assert(get('.home-balance-amount b').textContent === '—', 'Invented total'); assert(document.querySelector('.home-balance-trigger'), 'Missing chooser')
  })
  for (const mode of ['no-rates', 'rates-error', 'setting-error']) await check('H5: ' + mode + ' preserves visible balances', async () => {
    await mount(mode); assert(get('.home-balance-amount b').textContent === (mode === 'setting-error' ? '11 915,00 USD' : '8 450,00 USD'), 'Wrong fallback sum')
    assert(!document.querySelector('.home-balance [role="alert"]'), 'Optional failure hid balance')
  })
  for (const mode of ['data', 'save-error']) await check('BV-1: second level PUT ' + mode + ', focus, keyboard and closure', async () => {
    await mount(mode); await click('.home-balance-trigger'); assert(document.activeElement === get('[role="option"][aria-selected="true"]'), 'Initial selection focus')
    await click('.home-balance-setting'); assert(get('.home-balance-menu h2').textContent === 'Считать «Всего» в', 'Second level')
    assert(document.activeElement?.textContent?.includes('Доллар США'), 'Second level selected focus')
    await press(document.activeElement as HTMLElement, 'ArrowDown'); assert(document.activeElement?.textContent?.includes('Евро'), 'Arrow selection')
    await act(async () => (document.activeElement as HTMLElement).click()); await settle()
    assert(get('.home-balance-menu h2').textContent === 'Основной счёт', 'No first level return')
    assert(get('.home-balance-amount b').textContent === (mode === 'save-error' ? '11 915,00 USD' : '10 755,00 EUR'), 'Currency total')
    assert(document.activeElement === get('[role="option"][aria-selected="true"]'), 'First level focus')
    const calls = current.state.calls.filter(c => c.path === '/user/setting' && c.method === 'PUT'); assert(calls.length === 1, 'PUT count')
    assert(!!document.querySelector('[role="alert"]') === (mode === 'save-error'), 'Save failure must be visible')
    if (mode === 'save-error') assert(!get('[role="alert"]').closest('[inert]'), 'Save error is hidden behind modal background')
    await press(document.activeElement as HTMLElement, 'Escape'); assert(!document.querySelector('.home-balance-menu') && document.activeElement === get('.home-balance-trigger'), 'Escape focus')
    await click('.home-balance-trigger'); await click('.home-balance-trigger'); assert(!document.querySelector('.home-balance-menu'), 'Repeated trigger')
    await click('.home-balance-trigger'); await act(async () => get('.home-balance-caption').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await settleClose()
    assert(!document.querySelector('.home-balance-menu') && document.activeElement === get('.home-balance-trigger'), 'Outside focus')
  })
  await check('BV-1: groups include zeroes, crypto precision, scrolling and plural missing note', async () => {
    await mount('many'); await click('.home-balance-trigger'); assert(get('.home-balance-option').textContent?.includes('не учтены'), 'Plural missing')
    assert(get('.home-balance-options').textContent?.includes('0,02 BTC'), 'Crypto amount precision')
    assert(document.querySelectorAll('.home-currency-check').length === 1, 'First level selected badge')
    await click('.home-balance-setting')
    assert(document.querySelectorAll('.home-currency-art').length === 11, 'Known currency SVGs')
    assert(document.querySelectorAll('.home-currency-check').length === 1 && !document.querySelector('.home-total-option > svg'), 'Badge replaces trailing check')
    assert(get('.home-balance-options').textContent?.includes('Австралийский доллар') && get('.home-balance-options').textContent?.includes('Канадский доллар'), 'AUD/CAD names')
    const groups = document.querySelectorAll('[role="group"]'); assert(groups.length === 2 && groups[0].getAttribute('aria-label') === 'Валюты' && groups[1].getAttribute('aria-label') === 'Криптовалюты', 'Currency groups')
    assert(document.querySelectorAll('[role="option"]').length === 20 && document.querySelectorAll('.home-zero').length === 11, 'Zero currencies missing')
    const scroll = get('.home-balance-options'); assert(scroll.scrollHeight > scroll.clientHeight, 'Long list does not scroll')
    await click('.home-balance-back'); assert(get('.home-balance-menu h2').textContent === 'Основной счёт', 'Back button')
    if (mobile) { await click('.home-balance-close'); assert(document.activeElement === get('.home-balance-trigger'), 'Mobile close focus') }
    await mount()
  })
  await check('Prop: normal text and chips, only the destination button disabled', async () => {
    const card = get('.home-prop'), heading = get('.home-prop h2'), paragraph = get('.home-prop p')
    assert(!card.hasAttribute('aria-disabled') && !card.title, 'Whole Prop card disabled')
    assert(getComputedStyle(heading).color === getComputedStyle(get('.home-shell')).color, 'Prop heading dimmed')
    assert(getComputedStyle(paragraph).color === getComputedStyle(get('.home-bal .home-muted')).color, 'Prop description color')
    assert(!document.querySelector('.home-conditional'), 'R4 label remains')
    for (const element of card.querySelectorAll<HTMLElement>('h2, p, .home-chip, .home-conditional')) {
      assert(!element.closest('[aria-disabled="true"]') && getComputedStyle(element).opacity === '1', 'Prop text disabled/dimmed')
      if (element.classList.contains('home-chip')) assert(getComputedStyle(element).color === getComputedStyle(heading).color, 'Prop chip dimmed')
    }
    const button = get<HTMLButtonElement>('.home-prop button')
    assert(button.disabled && button.getAttribute('aria-disabled') === 'true' && button.title === 'Скоро', 'Prop destination enabled')
    assert(getComputedStyle(button).color !== getComputedStyle(heading).color, 'Prop destination not dimmed')
  })
  for (const [mode, block] of [['balance-error', '.home-balance'], ['operations-error', '.home-operations'], ['accounts-error', '.home-accounts']]) {
    await check(mode + ': isolated error and manual retry only', async () => {
      await mount(mode); assert(get(block).querySelector('[role="alert"]'), 'Missing block error')
      assert(document.querySelectorAll('[role="alert"]').length === 1, 'Other blocks lost')
      const before = current.state.calls.length; await act(async () => { await new Promise(r => setTimeout(r, 50)) }); assert(current.state.calls.length === before, 'Automatic retry')
      current.state.mode = 'data'; await click(block + ' .home-error button')
      for (let attempt = 0; attempt < 100 && get(block).querySelector('[role="alert"]'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      assert(!get(block).querySelector('[role="alert"]'), 'Retry failed')
      assert(!current.state.calls.slice(before).some(c => mode !== 'balance-error' && c.path === '/user/account/balance'), 'Unrelated balance reloaded')
    })
  }
  await check('loading: shell and independent skeletons', async () => { await mount('loading'); assert(document.querySelectorAll('[aria-busy="true"]').length === 3, 'Missing loading blocks'); assert(document.querySelector('.home-tabbar'), 'No navigation'); assert(visible('.home-operations .home-list-row').length === operationCount, 'Loading history count') })
  await check('401 during loading: shared refresh restores home', async () => { await mount('401'); assert(current.state.refreshes === 1, 'Refresh not shared'); assert(visible('.home-table tbody tr').length === operationCount, 'Data not restored'); assert(lost === 0, 'Unexpected logout') })
  await check('failed refresh returns expired session to App', async () => { await mount('expired'); assert(lost > 0, 'Session expiry not surfaced'); assert(!current.session.hasSession, 'Session retained'); assert(!document.querySelector('.home-table tbody tr'), 'Old rows visible') })
  await check('operation: Enter opens, focus goes to close, Esc restores row', async () => { await mount(); const row = get('.home-table tbody tr'); row.focus(); await press(row, 'Enter'); assert(get('.home-panel').contains(document.activeElement), 'Panel focus'); await press(document.activeElement as HTMLElement, 'Escape'); assert(!document.querySelector('.home-panel'), 'Panel still open'); assert(document.activeElement === row, 'Focus not restored') })
  await check('operation: repeated row and close button close details', async () => { await click('.home-table tbody tr'); await click('.home-table tbody tr'); assert(!document.querySelector('.home-panel'), 'Repeated row did not close'); await click('.home-table tbody tr'); await click('.home-panel button'); assert(!document.querySelector('.home-panel'), 'Close failed') })
  await check('disabled destinations: no handlers/hrefs, no requests or transitions', async () => {
    await mount(); await click('.home-user > .home-avatar')
    const before = current.state.calls.length, url = location.href
    for (const element of document.querySelectorAll<HTMLElement>('[aria-disabled="true"]')) {
      if (element.classList.contains('home-money-action')) {
        assert(element.getAttribute('aria-describedby') && !(element as HTMLButtonElement).disabled, 'Focusable money tooltip association')
        await act(async () => element.click()); await press(element, 'Enter'); await press(element, ' ')
        continue
      }
      assert(element.title === 'Скоро', 'Missing Soon tooltip'); assert(!element.hasAttribute('href'), 'Disabled href')
      const propKey = Object.keys(element).find(key => key.startsWith('__reactProps'))
      const props = propKey ? (element as unknown as Record<string, Record<string, unknown>>)[propKey] : {}
      assert(Object.entries(props).every(([key, value]) => !/^on[A-Z]/.test(key) || typeof value !== 'function'), 'Disabled event handler')
      await act(async () => element.click()); await press(element, 'Enter')
    }
    assert(current.state.calls.length === before && location.href === url, 'Disabled action executed')
  })
  await check('avatar: masked email, Esc restores focus, outside closes, logout available', async () => {
    await mount(); await click('.home-user > .home-avatar'); assert(get('.home-user-menu').textContent?.includes('an•••@example.invalid'), 'Email not masked'); assert(!get('.home-user-menu').textContent?.includes('anna@'), 'Email leaked')
    await press(document.activeElement as HTMLElement, 'Escape'); assert(!document.querySelector('.home-user-menu'), 'Menu remains'); assert(document.activeElement === get('.home-user > .home-avatar'), 'Avatar focus')
    await click('.home-user > .home-avatar'); await act(async () => get('.home-balance').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await settleClose(); assert(!document.querySelector('.home-user-menu'), 'Outside failed')
    await click('.home-user > .home-avatar'); await click('.home-user-row.danger'); assert(loggedOut === 1, 'Logout not wired')
  })
  await check('avatar: close only on mobile, visible initial focus and repeated avatar closes', async () => {
    await mount(); await click('.home-user > .home-avatar')
    assert(visible('.home-menu-close').length === (mobile ? 1 : 0), 'Menu close visibility')
    assert(document.activeElement === get(mobile ? '.home-menu-close' : '.home-user-row.danger'), 'Focus on hidden menu control')
    await click('.home-user > .home-avatar'); assert(!document.querySelector('.home-user-menu'), 'Repeated avatar did not close')
    if (mobile) { await click('.home-user > .home-avatar'); await click('.home-menu-close'); assert(!document.querySelector('.home-user-menu'), 'Mobile close failed'); assert(document.activeElement === get('.home-user > .home-avatar'), 'Mobile focus not restored') }
  })
  await check('avatar and operation overlays never coexist', async () => { await mount(); await click('.home-table tbody tr'); await click('.home-user > .home-avatar'); assert(!document.querySelector('.home-panel') && document.querySelector('.home-user-menu'), 'Overlay conflict'); await press(document.activeElement as HTMLElement, 'Escape') })
  await check('viewport fits without horizontal scroll', async () => { await mount(); assert(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow') })
  if (matchMedia('(max-width: 1199px)').matches) {
    await check('H7: money actions stay in one row, circles through 759px and pills from 760px', async () => {
      await document.fonts.ready
      const round = matchMedia('(max-width: 759px)').matches
      const actions = visible('.home-money-action').sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      assert(actions.length === 4, 'Unexpected action count')
      const positions = actions.map(e => e.getBoundingClientRect())
      assert(positions.every(rect => rect.top === positions[0].top), 'Actions wrapped')
      assert(positions.every((rect, i) => i === 0 || rect.left >= positions[i - 1].right), 'Actions overlap')
      assert(visible('.home-rail').length === (mobile ? 0 : 1) && visible('.home-tabbar-wrap').length === (mobile ? 1 : 0), 'Navigation breakpoint changed')
      if (round) {
        assert(actions.map(action => action.querySelector('.home-action-label')?.textContent).join(',') === 'Пополнить,Перевести,Вывести,Ещё', 'Wrong visual action order')
        assert(visible('.action-exch').length === 0, 'Exchange remains visible')
        for (const action of actions) {
          const icon = action.querySelector<HTMLElement>('.home-action-icon')!, label = action.querySelector<HTMLElement>('.home-action-label')!
          const rect = icon.getBoundingClientRect(), style = getComputedStyle(label)
          assert(rect.width === 48 && rect.height === 48 && getComputedStyle(icon).borderRadius === '50%', 'Not a 48px circle')
          assert(style.fontSize === (innerWidth <= 360 ? '11px' : '12px') && style.lineHeight === '16px', 'Wrong action typography')
          assert(label.getBoundingClientRect().height === 16 && label.getBoundingClientRect().width <= action.getBoundingClientRect().width, 'Action label wraps or overflows')
        }
      } else {
        assert(actions.map(action => action.querySelector('.home-action-label')?.textContent).join(',') === 'Ещё,Вывести,Перевести,Пополнить', 'Pill order changed')
        for (const action of actions) {
          const style = getComputedStyle(action), rect = action.getBoundingClientRect()
          assert(rect.height === (innerWidth >= 960 ? 36 : 40) && parseFloat(style.borderRadius) >= 20 && style.flexDirection === 'row', 'Not a 40px pill')
          assert(action.classList.contains('action-more') ? rect.width === (innerWidth >= 960 ? 36 : 40) : rect.width > 40, 'Pill width changed')
        }
      }
    })
  }
  if (mobile) {
    await check('mobile overlay traps keyboard focus', async () => { await click('.home-table tbody tr'); const close = get('.home-panel button'), body = get('.home-panel-body'); body.focus(); await press(body, 'Tab'); assert(document.activeElement === close, 'Panel trap failed'); await press(close, 'Escape'); await click('.home-user > .home-avatar'); const last = get('.home-user-row.danger'); last.focus(); await press(last, 'Tab'); assert(document.activeElement === get('.home-menu-close'), 'Menu trap failed'); await press(document.activeElement as HTMLElement, 'Escape') })
  }
  await check('refresh on focus updates balances, operation details, trading and profile without reload', async () => {
    const history = structuredClone(operations)
    await mount('data', history)
    current.state.balances = current.state.balances.map(balance => ({ ...balance, available: 0, reserved: 0 }))
    current.state.tradingBalance = 2345
    current.state.profile.firstName = 'Мария'
    history[0].amount = 123
    await act(async () => window.dispatchEvent(new Event('focus')))
    for (let attempt = 0; attempt < 100 && get('.home-balance-amount b').textContent !== '0,00 USD'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    await settle()
    assert(get('.home-balance-amount b').textContent === '0,00 USD', 'Stale balance')
    assert(get('.home-accounts').textContent?.includes('2 345'), 'Stale trading balance')
    assert(get('.home-table tbody tr').textContent?.includes('123 USD'), 'Stale operation')
    await click('.home-user > .home-avatar')
    assert(get('.home-user-head').textContent?.includes('Мария'), 'Stale profile')
    await press(document.activeElement as HTMLElement, 'Escape')
  })
  output.dataset.status = 'passed'
}
const scene = new URLSearchParams(location.search).get('scene')
if (scene) {
  output.hidden = true
  await mount(['long', 'new', 'loading', 'error', 'balance-error', 'operations-error', 'accounts-error', 'no-rates', 'rates-error', 'setting-error', 'save-error', 'setting-eur'].includes(scene) ? scene : 'data')
  if (['currencies', 'second-level', 'selected'].includes(scene)) await click('.home-balance-trigger')
  if (scene === 'second-level') await click('.home-balance-setting')
  if (scene === 'selected') await click('.home-balance-option:nth-of-type(3)')
  if (scene === 'detail') await click('.home-table tbody tr')
  if (scene === 'menu') await click('.home-user > .home-avatar')
  document.documentElement.dataset.ready = 'true'
} else void run().catch(error => { output.dataset.status = 'failed'; output.textContent = messages.join('\n') + '\nFAIL ' + String(error) })
