import { DepositFormsApi } from '../src/cabinet/deposit/forms-api.ts'
import { fixture } from './home-fixtures.ts'
export const usd = { code: 'USD', name: 'Доллар США', precision: 2 },
  eur = { code: 'EUR', name: 'Евро', precision: 2 },
  usdt = {
    code: 'USDT',
    name: 'Tether',
    precision: 6,
    cryptoTokenStandards: ['ERC20'],
  },
  btc = { code: 'BTC', name: 'Bitcoin', precision: 8 },
  eth = { code: 'ETH', name: 'Ethereum', precision: 8 }
const cfg = (
  type: string,
  option = type,
  route = type,
  order = 0,
  currencies: unknown[] = [],
  crypto = false,
) => ({
  financeOperationTypeName: 'Add',
  merchantCode: '',
  paymentTypeCode: type,
  paymentOptionCode: option,
  paymentRouteCode: route,
  isOpened: true,
  isVisible: true,
  order,
  paymentGroups: crypto ? [{ code: 'CryptoPayments' }] : [],
  currencies,
  minConfirmationsCount: 10,
})
export const formConfigs = [
  cfg('Ethereum', 'Tether', 'Ethereum', 0, [usdt, eth], true),
  cfg(
    'Tron',
    'Tether',
    'Tron',
    1,
    [{ ...usdt, cryptoTokenStandards: ['TRC20'] }],
    true,
  ),
  cfg('Bitcoin', 'Bitcoin', 'Bitcoin', 2, [btc], true),
  cfg('WireTransfer', 'WireTransfer', 'WireTransfer', 3, [usd, eur]),
  {
    ...cfg(
      'Litecoin',
      'Litecoin',
      'Litecoin',
      4,
      [{ code: 'LTC', name: 'Litecoin', precision: 8 }],
      true,
    ),
    merchantCode: 'softfx',
  },
]
export const testInvoice = {
  chainId: '00000000-0000-0000-0000-000000000001',
  invoice: {
    amount: '1000',
    currencyCode: 'USD',
    invoiceNumber: 'TEST-NOT-PAYABLE',
    paymentDate: '2026-10-30',
    header: [{ key: 'Документ', value: 'Тестовый инвойс. Не для оплаты.' }],
    body: {
      firstGroup: [
        { key: 'Получатель', value: '[Получатель из тестового транспорта]' },
      ],
      secondGroup: [
        {
          key: 'Банковские реквизиты',
          value: '[Данные из тестового транспорта — не для перевода]',
        },
      ],
      thirdGroup: [
        {
          key: 'Назначение',
          value:
            'Тестовое назначение с кириллицей. Поля и значения получены из синтетического ответа, настоящих реквизитов нет.',
        },
      ],
    },
  },
}
export function formsFixture(mode = 'data') {
  const f = fixture(),
    values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
  const state = {
    mode,
    calls: [] as {
      path: string
      method: string
      query: URLSearchParams
      body: Record<string, unknown> | undefined
    }[],
    posts: 0,
    delay: 0,
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = init?.method ?? 'GET',
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    state.calls.push({ path, method, query: url.searchParams, body })
    if (state.delay)
      await new Promise((resolve) => setTimeout(resolve, state.delay))
    if (init?.signal?.aborted) throw init.signal.reason
    let data: unknown,
      status = 200
    if (path === '/paymentsystem/configuration') {
      if (state.mode === 'load-error')
        return new Response('{}', { status: 503 })
      data = formConfigs
    } else if (path === '/paymentsystem/currency') {
      if (state.mode === 'load-error')
        return new Response('{}', { status: 503 })
      const config = formConfigs.find(
        (c) => c.paymentTypeCode === url.searchParams.get('paymentTypeCode'),
      )
      data = config?.currencies ?? []
    } else if (path === '/account')
      data = [
        {
          number: 'TEST-MAIN',
          type: { name: 'EWallet' },
          isEnabled: true,
          currencies: [usd, eur],
        },
        {
          number: 'TEST-TRADING',
          type: { name: 'Trading' },
          isEnabled: 'True',
          isDemo: 'False',
          isArchived: 'False',
          currencies: [usd],
        },
      ]
    else if (path === '/user/account/balance')
      data = [
        { currency: usd, available: 0, reserved: 0 },
        { currency: eur, available: 0, reserved: 0 },
        { currency: usdt, available: 5, reserved: 0 },
      ]
    else if (path === '/user/summary')
      data = {
        profiles:
          state.mode === 'no-country'
            ? []
            : [
                {
                  type: 'Personal',
                  address: { country: 'United States', countryCode: 'US' },
                },
              ],
      }
    else if (path === '/paymentsystem/fee') {
      if (state.mode === 'terms-error')
        return new Response('{}', { status: 503 })
      const code = url.searchParams.get('currencyCode')
      data = [
        {
          currency:
            code === 'USDT'
              ? usdt
              : code === 'BTC'
                ? btc
                : code === 'ETH'
                  ? eth
                  : code === 'EUR'
                    ? eur
                    : code === 'LTC'
                      ? { code: 'LTC', name: 'Litecoin', precision: 8 }
                      : usd,
          percent: 0.002,
          constant: 0,
          minValue: 0,
          maxValue: null,
        },
      ]
    } else if (path === '/paymentsystem/amountrange')
      data = { min: 0.01, max: 100000 }
    else if (path === '/paymentsystem/exchange/currencyrate')
      data = { isRateMissing: false, rateValue: 1.1 }
    else if (path === '/paymentsystem/crypto/token') {
      if (state.mode === 'token-unavailable')
        return new Response(
          JSON.stringify({ error: { code: 'PAYMENT_METHOD_UNAVAILABLE' } }),
          { status: 400 },
        )
      data =
        url.searchParams.get('currencyCode') === 'USDT'
          ? [
              {
                cryptoTokenStandardCode:
                  url.searchParams.get('paymentTypeCode') === 'Tron'
                    ? 'TRC20'
                    : 'ERC20',
              },
            ]
          : []
    } else if (path === '/paymentsystem/wiretransfer/bank')
      data = {
        banks:
          state.mode === 'no-banks'
            ? []
            : [
                {
                  key: '00000000-0000-0000-0000-000000000001',
                  value: '[Тестовый банк]',
                },
              ],
      }
    else if (
      path === '/paymentsystem/cryptoaddress/create' ||
      path === '/paymentsystem/wiretransfer/add'
    ) {
      state.posts++
      if (state.mode === 'post-network')
        throw new TypeError('Synthetic unavailable')
      if (state.mode === 'post-500') status = 503
      if (state.mode === 'post-401') status = 401
      if (state.mode === 'post-400') {
        status = 400
        data = { error: { code: 'PAYMENT_REJECTED' } }
      } else
        data =
          state.mode === 'post-invalid'
            ? {}
            : path.includes('cryptoaddress')
              ? {
                  value: '[Адрес от сервера · тестовый транспорт]',
                  paymentTag: '[Тег от сервера · тест]',
                }
              : testInvoice
    } else throw new Error('Unexpected synthetic form path: ' + path)
    return new Response(JSON.stringify(data), { status })
  }
  return {
    ...f,
    authState: f.state,
    state,
    formApi: new DepositFormsApi(f.session, fetcher, storage),
    formFetcher: fetcher,
    markers: values,
    markerStorage: storage,
  }
}
