import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CabinetShell as CabinetHome } from '../src/cabinet/CabinetShell'
import { CountryPicker } from '../src/CountryPicker'
import { fixture } from './home-fixtures'
import '../src/styles.css'

// Dev-only, synthetic transport. No production/demo mode or real API calls.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const root = createRoot(document.getElementById('test-root')!)
const params = new URLSearchParams(location.search)
if (params.get('scene') === 'countries') {
  const codes = ['DE', 'AR', 'AM', 'AW', 'AU', 'AT', 'BE', 'BR', 'BG', 'CA', 'CN', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GE', 'GR', 'HU', 'IN', 'IE', 'IL', 'IT', 'JP', 'KZ', 'LV', 'LT', 'LU', 'MT', 'MX', 'NL', 'NZ', 'NO', 'PL', 'PT', 'RO', 'RS', 'SG', 'ES', 'SE', 'CH', 'TR', 'UA', 'GB', 'US']
  await act(async () => root.render(createElement(CountryPicker, { countries: codes.map(code => ({ code, name: code })), value: '', disabled: false, loading: false, invalid: false, onChange: () => {}, onBlur: () => {} })))
  await act(async () => document.querySelector<HTMLButtonElement>('#country')!.click())
} else {
  const current = fixture()
  const codes = ['USD', 'EUR', 'JPY', 'CHF', 'RUB', 'CNY', 'AUD', 'CAD', 'BTC', 'ETH', 'USDT', 'USDC', 'LTC', 'XRP', 'SOL', 'ADA', 'DOT', 'DOGE', 'BCH', 'ETC']
  current.state.balances = codes.slice(0, Number(params.get('count') ?? 8)).map((code, i) => ({ available: 100 - i, reserved: 0, currency: { code, precision: 2 }, currencyRate: 1, defaultDomainCurrencyCode: 'USD' }))
  await current.session.check()
  await act(async () => root.render(createElement(CabinetHome, { session: current.session, api: current.home, onSessionLost: () => {}, onLogout: () => {} })))
  for (let i = 0; i < 100 && document.querySelector('[aria-busy="true"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}
document.documentElement.dataset.ready = 'true'

if (params.has('test')) {
  const output = document.getElementById('test-results')!
  const checks: string[] = []
  function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); checks.push('PASS ' + message) }
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
  try {
    await act(async () => document.querySelector<HTMLButtonElement>('.home-balance-trigger')!.click())
    for (const level of [1, 2]) {
      await frame()
      const card = document.querySelector<HTMLElement>('.home-balance-menu')!
      const list = card.querySelector<HTMLElement>('.home-balance-options')!
      const area = card.querySelector<HTMLElement>('.overlay-scroll')!
      const thumb = card.querySelector<HTMLElement>('.overlay-scroll-thumb')!
      const overflow = list.scrollHeight > list.clientHeight + 1
      if (innerWidth > 600 && [600, 900].includes(innerHeight)) {
        assert(overflow === (innerHeight === 600), `level ${level}: content height at ${innerHeight}`)
        assert(card.getBoundingClientRect().bottom <= innerHeight - 24 + 1, `level ${level}: viewport bottom limit`)
      }
      assert(getComputedStyle(list).scrollbarWidth === 'none', `level ${level}: no system scrollbar`)
      assert(getComputedStyle(thumb).width === '4px', `level ${level}: overlay width`)
      assert(getComputedStyle(thumb).transitionDuration.split(', ').every(value => value === '0.3s'), `level ${level}: opacity/color duration, including reduced motion`)
      if (innerWidth <= 600) assert(getComputedStyle(thumb).display === 'none', `level ${level}: no mobile thumb`)
      if (overflow) {
        list.scrollTop = 80
        await frame(); await frame()
        assert(String(area.dataset.scrolled) === 'true', `level ${level}: scrolled state`)
        assert(getComputedStyle(card.querySelector('.home-balance-menu-head')!).boxShadow !== 'none', `level ${level}: divider below fixed header`)
        list.scrollTop = 0
        await frame(); await frame()
        assert(String(area.dataset.scrolled) === 'false', `level ${level}: divider resets at top`)
      }
      if (level === 1) await act(async () => document.querySelector<HTMLButtonElement>('.home-balance-setting')!.click())
    }
    output.dataset.status = 'passed'
  } catch (error) { checks.push('FAIL ' + String(error)); output.dataset.status = 'failed' }
  output.textContent = checks.join('\n')
}
