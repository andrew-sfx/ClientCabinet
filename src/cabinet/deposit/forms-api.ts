import { AuthError, CabinetApi, object } from '../../auth/api.ts'
import { authConfig } from '../../auth/config.ts'
import type { Session } from '../../auth/session.ts'
import { configKey } from './model.ts'
import {
  allowedConfigs,
  contextQuery,
  detailedConfigs,
  finite,
  networksFor,
  parseAddress,
  parseCountry,
  parseCurrency,
  parseInvoice,
  parseTerms,
  rows,
  text,
} from './forms-model.ts'
import type {
  DepositData,
  Destination,
  DetailedConfig,
  PaymentCurrency,
  Selection,
} from './forms-model.ts'
export type DepositKind = 'crypto' | 'wire'
export interface MarkerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export class OperationUnknown extends AuthError {
  constructor() {
    super('OPERATION_UNKNOWN')
  }
}
const submitting = new WeakMap<Session, Set<string>>()
export class DepositFormsApi {
  private session: Session
  private fetcher: typeof fetch
  private storage?: MarkerStorage
  constructor(
    session: Session,
    fetcher: typeof fetch = fetch,
    storage?: MarkerStorage,
  ) {
    this.session = session
    this.fetcher = fetcher
    this.storage = storage
  }
  private assertRevision(revision: number) {
    if (!this.session.hasSession || this.session.accountRevision !== revision)
      throw new AuthError('SESSION_EXPIRED')
  }
  private client(signal: AbortSignal) {
    const revision = this.session.accountRevision
    return new CabinetApi((url, init) => {
      signal.throwIfAborted()
      if (!this.session.hasSession || this.session.accountRevision !== revision)
        throw new AuthError('SESSION_EXPIRED')
      const fetcher = this.fetcher
      return fetcher(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          ...(init?.signal ? [init.signal] : []),
        ]),
      })
    })
  }
  private async get(
    path: string,
    query: Record<string, string>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    const client = this.client(signal)
    return this.session.authenticated((access) =>
      client.request(
        path +
          '?' +
          new URLSearchParams({ ...query, domainName: authConfig.domainName }),
        {},
        access,
      ),
    )
  }

  async load(
    kind: DepositKind,
    key: string,
    signal: AbortSignal,
  ): Promise<DepositData> {
    const revision = this.session.accountRevision
    const [raw, grade] = await Promise.all([
      this.get(
        '/paymentsystem/configuration',
        {
          financeOperationTypeName: 'Add',
          isExternal: 'true',
          isVisible: 'true',
        },
        signal,
      ),
      this.get(
        '/paymentsystem/configuration',
        {
          financeOperationTypeName: 'Add',
          isExternal: 'true',
          isVisible: 'true',
          checkGrade: 'true',
        },
        signal,
      ),
    ])
    const supported = allowedConfigs(
      detailedConfigs(raw),
      detailedConfigs(grade),
    )
    let configs = supported.filter((c) =>
      kind === 'crypto'
        ? c.crypto && c.paymentTypeCode !== 'CryptoPayments'
        : configKey(c) === key && c.paymentTypeCode === 'WireTransfer',
    )
    if (!configs.length) throw new AuthError('METHOD_UNAVAILABLE')
    // Crypto network standards belong to Configuration.currencies. /currency may omit them.
    if (kind === 'wire')
      configs = await Promise.all(
        configs.map(async (config) => ({
          ...config,
          currencies: rows(
            await this.get(
              '/paymentsystem/currency',
              contextQuery(config),
              signal,
            ),
          ).map(parseCurrency),
        })),
      )
    this.assertRevision(revision)
    const main = this.session.summary?.mainAccountNumber
    if (!main) throw new AuthError('ACCOUNT_UNAVAILABLE')
    const [accountRaw, balanceRaw, summary] = await Promise.all([
      this.get('/account', {}, signal),
      this.get('/user/account/balance', { account: main }, signal),
      kind === 'wire'
        ? this.get('/user/summary', {}, signal)
        : Promise.resolve(undefined),
    ])
    const balances = rows(balanceRaw).map(object),
      accounts: Destination[] = balances.map((r) => {
        const currency = parseCurrency(r.currency)
        return {
          key: JSON.stringify([main, currency.code]),
          number: main,
          label: 'Основной счёт',
          currency,
          available: finite(r.available),
          wallet: true,
        }
      })
    if (kind === 'crypto') {
      accounts.length = 0
      accounts.push({
        key: main,
        number: main,
        label: 'Основной счёт',
        wallet: true,
      })
    }
    if (!accounts.length)
      accounts.push({
        key: main,
        number: main,
        label: 'Основной счёт',
        wallet: true,
      })
    // Runtime /account is an array despite Swagger's single Account schema. Only positively enabled real trading destinations are exposed for wire.
    for (const raw of rows(accountRaw)) {
      const a = object(raw)
      const flag = (v: unknown) =>
        v === true || v === 'True' || v === 'true'
          ? true
          : v === false || v === 'False' || v === 'false'
            ? false
            : undefined
      if (
        kind !== 'wire' ||
        object(a.type).name !== 'Trading' ||
        flag(a.isDemo) !== false ||
        flag(a.isArchived) !== false ||
        flag(a.isEnabled) !== true
      )
        continue
      for (const c of rows(a.currencies ?? [])) {
        const currency = parseCurrency(c),
          number = text(a.number)
        accounts.push({
          key: JSON.stringify([number, currency.code]),
          number,
          label: 'Торговый счёт ' + number,
          currency,
          wallet: false,
        })
      }
    }
    const networks = networksFor(configs),
      currencies =
        kind === 'crypto'
          ? [
              ...new Map(
                networks.map((n) => [n.currency.code, n.currency]),
              ).values(),
            ]
          : configs[0].currencies
    signal.throwIfAborted()
    this.assertRevision(revision)
    return {
      revision,
      configs,
      networks,
      currencies,
      accounts,
      country: summary === undefined ? undefined : parseCountry(summary),
    }
  }
  private async tokens(selection: Selection, signal: AbortSignal) {
    const { config, currency, network } = selection
    const query: Record<string, string> = {
      merchantCode: config.merchantCode ?? '',
      paymentTypeCode: config.paymentTypeCode,
      ...(config.paymentOptionCode === null
        ? {}
        : { paymentOptionCode: config.paymentOptionCode }),
      ...(config.paymentRouteCode === null
        ? {}
        : { paymentRouteCode: config.paymentRouteCode }),
      currencyCode: currency.code,
      ...(network?.token ? { cryptoTokenStandardCode: network.token } : {}),
    }
    return this.get('/paymentsystem/crypto/token', query, signal)
  }

  async terms(
    selection: Selection,
    country: DepositData['country'],
    signal: AbortSignal,
  ) {
    const revision = selection.revision
    this.assertRevision(revision)
    const { config, currency, account, network } = selection,
      // .com Bitcoin/Litecoin Add has no Token selector or prerequisite.
      nativeWithoutToken =
        !network?.token &&
        ((config.paymentTypeCode === 'Bitcoin' && currency.code === 'BTC') ||
          (config.paymentTypeCode === 'Litecoin' && currency.code === 'LTC')),
      checkTokens = !!network && !nativeWithoutToken,
      query = {
        ...contextQuery(config),
        currencyCode: currency.code,
        ...(country ? { countryCode: country.code } : {}),
      }
    const [fees, range, balance, rate, tokens] = await Promise.all([
      this.get('/paymentsystem/fee', query, signal),
      this.get(
        '/paymentsystem/amountrange',
        {
          paymentType: config.paymentTypeCode,
          ...(config.paymentOptionCode === null
            ? {}
            : { paymentOption: config.paymentOptionCode }),
          ...(config.paymentRouteCode === null
            ? {}
            : { paymentRoute: config.paymentRouteCode }),
          balanceOperationType: 'Credit',
          currencyCode: currency.code,
          ...(country ? { countryCode: country.code } : {}),
        },
        signal,
      ),
      this.get('/user/account/balance', { account: account.number }, signal),
      account.currency && account.currency.code !== currency.code
        ? this.get(
            '/paymentsystem/exchange/currencyrate',
            {
              currencyCodeFrom: currency.code,
              currencyCodeTo: account.currency.code,
              isForward: 'true',
            },
            signal,
          )
        : Promise.resolve(undefined),
      checkTokens ? this.tokens(selection, signal) : Promise.resolve(undefined),
    ])
    if (network && checkTokens) {
      const codes = rows(tokens).map((t) => object(t).cryptoTokenStandardCode)
      if (
        network.token
          ? !codes.includes(network.token)
          : codes.some((c) => typeof c === 'string' && c)
      )
        throw new AuthError('TOKEN_UNAVAILABLE')
    }
    signal.throwIfAborted()
    this.assertRevision(revision)
    return parseTerms(fees, range, currency, balance, account, rate)
  }

  private markerStorage() {
    if (this.storage) return this.storage
    if (typeof window === 'undefined') return undefined
    try {
      return window.sessionStorage
    } catch {
      throw new AuthError('STORAGE_UNAVAILABLE')
    }
  }
  private async markerKey(kind: DepositKind, number: string) {
    const bytes = new TextEncoder().encode(
      JSON.stringify([authConfig.apiUrl, authConfig.domainName, number, kind]),
    )
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return (
      'clientcabinet.deposit.pending.' +
      Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
    )
  }
  async hasUnknown(kind: DepositKind, number: string) {
    const key = await this.markerKey(kind, number)
    try {
      return !!this.markerStorage()?.getItem(key)
    } catch {
      throw new AuthError('STORAGE_UNAVAILABLE')
    }
  }
  private async once(
    kind: DepositKind,
    number: string,
    body: unknown,
    path: string,
    parse: (value: unknown) => unknown,
    signal: AbortSignal,
  ) {
    const revision = this.session.accountRevision
    let locks = submitting.get(this.session)
    if (!locks) {
      locks = new Set()
      submitting.set(this.session, locks)
    }
    const identity = kind + ':' + number
    if (locks.has(identity)) throw new AuthError('SUBMIT_IN_PROGRESS')
    locks.add(identity)
    let sent = false
    let store: MarkerStorage | undefined
    try {
      const key = await this.markerKey(kind, number)
      this.assertRevision(revision)
      store = this.markerStorage()
      if (store?.getItem(key)) throw new OperationUnknown()
      signal.throwIfAborted()
      store?.setItem(key, 'pending')
      const client = this.client(signal)
      try {
        const response = await this.session.authenticated((access) => {
          if (sent) throw new OperationUnknown()
          signal.throwIfAborted()
          this.assertRevision(revision)
          sent = true
          return client.post(
            path,
            { ...object(body), domainName: authConfig.domainName },
            access,
          )
        })
        this.assertRevision(revision)
        const result = parse(response)
        store?.removeItem(key)
        return result
      } catch (error) {
        if (!sent) {
          store?.removeItem(key)
          throw error
        }
        // Only an explicit 4xx response (except timeout/gateway ambiguity) proves a rejected request. Never replay a callback.
        if (
          error instanceof AuthError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![408, 409].includes(error.status)
        ) {
          store?.removeItem(key)
          throw error
        }
        throw new OperationUnknown()
      }
    } finally {
      locks.delete(identity)
    }
  }
  async createAddress(selection: Selection, signal: AbortSignal) {
    this.assertRevision(selection.revision)
    const { account, currency, config, network } = selection
    if (
      !account.wallet ||
      !network ||
      network.currency.code !== currency.code ||
      configKey(network.config) !== configKey(config)
    )
      throw new AuthError('ACCOUNT_UNAVAILABLE')
    return this.once(
      'crypto',
      account.number,
      {
        accountNumber: account.number,
        currencyCode: currency.code,
        paymentTypeCode: config.paymentTypeCode,
        paymentOptionCode: config.paymentOptionCode,
        paymentRouteCode: config.paymentRouteCode,
        ...(network.token ? { cryptoTokenStandardCode: network.token } : {}),
        reuse: true,
      },
      '/paymentsystem/cryptoaddress/create',
      parseAddress,
      signal,
    ) as Promise<ReturnType<typeof parseAddress>>
  }
  async createInvoice(
    selection: Selection,
    amount: number,
    country: NonNullable<DepositData['country']>,
    signal: AbortSignal,
  ) {
    if (
      !country?.code ||
      !country.name ||
      !(Number.isFinite(amount) && amount > 0)
    )
      throw new AuthError('COUNTRY_REQUIRED')
    const revision = selection.revision
    this.assertRevision(revision)
    const { account, currency, config } = selection
    let locks = submitting.get(this.session)
    if (!locks) {
      locks = new Set()
      submitting.set(this.session, locks)
    }
    const preflight = 'wire-preflight:' + account.number
    if (locks.has(preflight)) throw new AuthError('SUBMIT_IN_PROGRESS')
    locks.add(preflight)
    try {
      const b = object(
          await this.get(
            '/paymentsystem/wiretransfer/bank',
            {
              balanceOperationTypeName: 'Credit',
              paymentType: config.paymentTypeCode,
              ...(config.paymentOptionCode === null
                ? {}
                : { paymentOption: config.paymentOptionCode }),
              ...(config.paymentRouteCode === null
                ? {}
                : { paymentRoute: config.paymentRouteCode }),
              merchant: config.merchantCode ?? '',
              countryCode: country.code,
              currencyCode: currency.code,
            },
            signal,
          ),
        ),
        banks = rows(b.banks)
      this.assertRevision(revision)
      if (!banks.length) throw new AuthError('NO_BANKS_AVAILABLE')
      const bankId = text(object(banks[0]).key)
      return (await this.once(
        'wire',
        account.number,
        {
          paymentOptionCode: config.paymentOptionCode,
          paymentDetails: { bankCountry: country.name, bankId },
          accountNumber: account.number,
          accountCurrencyCode: account.currency?.code ?? currency.code,
          currencyCode: currency.code,
          amount,
        },
        '/paymentsystem/wiretransfer/add',
        parseInvoice,
        signal,
      )) as ReturnType<typeof parseInvoice>
    } finally {
      locks.delete(preflight)
    }
  }
}
export function chosenConfig(
  data: DepositData,
  kind: DepositKind,
  currency: PaymentCurrency,
  networkKey: string,
): DetailedConfig | undefined {
  return kind === 'wire'
    ? data.configs.find((c) =>
        c.currencies.some((v) => v.code === currency.code),
      )
    : data.networks.find(
        (n) => n.key === networkKey && n.currency.code === currency.code,
      )?.config
}
