// Synthetic transport shared by Node/browser tests. Never imported by the app.
import { CabinetApi } from '../src/auth/api.ts'
import { Session, SESSION_KEY } from '../src/auth/session.ts'
import { HomeApi } from '../src/cabinet/api.ts'

export const usd = { code: 'USD', precision: 2 }
export const summary = { id: 'synthetic-user', firstName: 'Анна', lastName: 'Петрова', email: 'anna@example.invalid', mainAccountNumber: 'SYNTHETIC-MAIN', accounts: [
  { accountNumber: 'SYNTHETIC-MAIN', type: 'Main' },
  { accountNumber: 'TEST-1001', type: 'Trading', platformType: 'TickTrader', productCode: 'TT_Cash' },
  { accountNumber: 'TEST-1002', type: 'Trading', platformType: 'MetaTrader 5', productCode: 'Standard' },
  { accountNumber: 'TEST-DEMO', type: 'Trading', platformType: 'TickTrader' },
  { accountNumber: 'TEST-ARCHIVED', type: 'Trading', platformType: 'TickTrader' },
] }
export const balances = [
  { available: 8200, reserved: 250, currency: usd, currencyRate: 1, defaultDomainCurrencyCode: 'USD' },
  { available: 3150, reserved: 0, currency: { code: 'EUR', precision: 2 }, currencyRate: 1.1, defaultDomainCurrencyCode: 'USD' },
  { available: 520, reserved: 0, currency: { code: 'GBP', precision: 2 }, currencyRate: 1.2, defaultDomainCurrencyCode: 'USD' },
]
export const operations = [
  { id: 'synthetic-operation-1', type: { name: 'Add', balanceOperationType: { isPositive: true } }, paymentOptionType: { option: { name: 'Банковская карта' } }, created: '2026-10-29T11:12:00Z', status: { code: 'Succeed', name: 'Success' }, isStatusFinal: true, amount: 5000, fee: 0, currency: usd, account: { number: 'SYNTHETIC-MAIN' } },
  { id: 'synthetic-operation-2', type: { name: 'Перевод на торговый счёт', balanceOperationType: { isPositive: false } }, paymentOptionType: { type: { name: 'Transfer' }, option: { name: 'TickTrader' } }, created: '2026-10-28T06:40:00Z', status: { code: 'Succeed', name: 'Success' }, isStatusFinal: true, amount: 1000, fee: 0, currency: usd, account: { number: 'SYNTHETIC-MAIN' } },
  { id: 'synthetic-operation-3', type: { name: 'Обмен USD → EUR', balanceOperationType: { isPositive: false } }, paymentOptionType: { type: { name: 'Exchange' }, option: { name: 'Обмен' } }, created: '2026-10-27T15:05:00Z', status: { code: 'Succeed', name: 'Success' }, isStatusFinal: true, amount: 1100, fee: 0, currency: usd, account: { number: 'SYNTHETIC-MAIN' } },
  { id: 'synthetic-operation-4', type: { name: 'Withdraw', balanceOperationType: { isPositive: false } }, paymentOptionType: { option: { name: 'Банковский перевод' } }, created: '2026-10-26T08:27:00Z', status: { code: 'In progress', name: 'In progress' }, isStatusFinal: false, amount: 250, fee: 0, currency: usd, account: { number: 'SYNTHETIC-MAIN' } },
  { id: 'synthetic-operation-5', type: { name: 'Add', balanceOperationType: { isPositive: true } }, paymentOptionType: { option: { name: 'Crypto' } }, created: '2026-10-25T17:51:00Z', status: { code: 'Rejected', name: 'Rejected' }, isStatusFinal: true, amount: 500, fee: 0, currency: usd, account: { number: 'SYNTHETIC-MAIN' } },
]
export function fixture(initialMode = 'data', history: unknown[] = operations) {
  const state = { mode: initialMode, refreshes: 0, setting: initialMode === 'setting-eur' ? 'EUR' : initialMode === 'setting-unknown' ? 'ZZZ' : '',
    profile: structuredClone(summary), tradingBalance: 1000,
    balances: initialMode === 'no-default' ? balances.map(balance => ({ ...balance, defaultDomainCurrencyCode: undefined as string | undefined })) : initialMode === 'unknown-currency' ? [{ ...balances[0], currency: { code: 'BYN', precision: 2 }, defaultDomainCurrencyCode: 'BYN' }] : initialMode === 'new' ? [] : initialMode === 'missing-default' ? balances.map(balance => ({ ...balance, defaultDomainCurrencyCode: 'AUD' })) : balances,
    rates: [{ currencyFrom: 'EUR', currencyTo: 'USD', value: 1.1 }, { currencyFrom: 'USD', currencyTo: 'EUR', value: 0.9 }],
    calls: [] as { path: string; method: string; query: URLSearchParams; body: unknown; access: string | null }[] }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, access = new Headers(init?.headers).get('Authorization')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    state.calls.push({ path, method: init?.method ?? 'GET', query: url.searchParams, body, access })
    let data: unknown, status = 200
    if (path === '/user/account/summary') data = state.mode === 'new' ? { ...state.profile, accounts: [] } : state.profile
    else if (path === '/token') { state.refreshes++; data = state.mode === 'expired' ? {} : { token_type: 'Bearer', access_token: 'synthetic-new', refresh_token: 'synthetic-next', expires_in: 3600 }; if (state.mode === 'expired') status = 401 }
    else if (path === '/token/revoke') data = null
    else if (['401', 'expired'].includes(state.mode) && access === 'Bearer synthetic-old') { status = 401; data = {} }
    else if (state.mode === 'loading') return new Promise<Response>(() => {})
    else if (state.mode === 'error' || (state.mode === 'balance-error' && path === '/user/account/balance') || (state.mode === 'operations-error' && path === '/user/financeoperation') || (state.mode === 'accounts-error' && path === '/tradingaccount')) { status = 503; data = {} }
    else if (path === '/user/account/balance') data = state.balances
    else if (path === '/user/setting') {
      if ((init?.method === 'PUT' && state.mode === 'save-error') || (init?.method !== 'PUT' && state.mode === 'setting-error')) { status = 503; data = {} }
      else if (init?.method === 'PUT') { state.setting = (body as { settings: { value: string }[] }).settings[0].value; data = null }
      else data = state.setting ? [{ key: 'PORTAL_WEB_CURRENCY_OF_TOTALS', value: state.setting }] : []
    }
    else if (path === '/currencyrates') {
      if (state.mode === 'rates-error') { status = 503; data = {} }
      else data = state.mode === 'no-rates' ? [] : state.rates.filter(rate => (body as { currencyCodesTo: string[] }).currencyCodesTo.includes(rate.currencyTo))
    }
    else if (path === '/user/financeoperation') data = { data: state.mode === 'new' ? [] : history, pageNumber: 1, pageSize: 5 }
    else if (path === '/account') data = summary.accounts.map(a => ({ number: a.accountNumber, type: { name: a.type }, isDemo: a.accountNumber === 'TEST-DEMO', isArchived: a.accountNumber === 'TEST-ARCHIVED' }))
    else if (path === '/tradingaccount') data = summary.accounts.slice(1, 3).map((a, i) => ({ accountNumber: a.accountNumber, leverage: { value: i === 0 ? 100 : 30 }, status: i === 0 ? 'Full' : 'Frozen', readonly: i !== 0, balances: [{ balance: state.mode === 'long' ? 12345678.12345678 : i === 0 ? state.tradingBalance : 0, currency: state.mode === 'long' ? { code: 'BTC', precision: 8 } : usd }] }))
    else throw new Error('Unexpected synthetic route: ' + path)
    return new Response(JSON.stringify(data), { status })
  }
  const values = new Map([[SESSION_KEY, JSON.stringify({ access: 'synthetic-old', refresh: 'synthetic-refresh', expiresAt: Date.now() + 3600000 })]])
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const api = new CabinetApi(fetcher), session = new Session(api, storage), home = new HomeApi(session, api)
  return { state, api, session, home, storage, fetcher }
}
