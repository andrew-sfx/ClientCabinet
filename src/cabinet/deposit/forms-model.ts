import { AuthError, object } from '../../auth/api.ts'
import { configKey, parseConfigs } from './model.ts'
import type { PaymentConfig } from './model.ts'
export interface PaymentCurrency {
  code: string
  name: string
  precision: number
  tokens: string[]
}
export interface DetailedConfig extends PaymentConfig {
  currencies: PaymentCurrency[]
  confirmations?: number
}
export interface Destination {
  key: string
  number: string
  label: string
  currency?: PaymentCurrency
  available?: number
  wallet: boolean
}
export interface Network {
  key: string
  label: string
  config: DetailedConfig
  currency: PaymentCurrency
  token?: string
}
export interface DepositData {
  revision: number
  configs: DetailedConfig[]
  currencies: PaymentCurrency[]
  networks: Network[]
  accounts: Destination[]
  country?: { code: string; name: string }
}
export interface Fee {
  currency: PaymentCurrency
  percent: number
  constant: number
  min: number
  max?: number
}
export interface Terms {
  min: number
  max: number
  fee?: Fee
  available?: number
  balanceCurrency?: string
  rate?: number
}
export interface Selection {
  revision: number
  account: Destination
  currency: PaymentCurrency
  config: DetailedConfig
  network?: Network
}
export interface Invoice {
  header: { key: string; value: string }[]
  groups: { key: string; value: string }[][]
  amount: string
  currency: string
  number: string
  date: string
}
export interface AddressResult {
  value: string
  tag?: string
}
export const invalid = (): never => {
  throw new AuthError('INVALID_RESPONSE')
}
export const rows = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : invalid()
export const text = (value: unknown): string =>
  typeof value === 'string' && value.length && value.length <= 20000
    ? value
    : invalid()
export const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : invalid()
export function parseCurrency(value: unknown): PaymentCurrency {
  const r = object(value),
    precision = finite(r.precision),
    code = text(r.code)
  if (
    !/^[A-Z0-9._-]{1,20}$/i.test(code) ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 20
  )
    return invalid()
  return {
    code,
    name: typeof r.name === 'string' ? r.name : code,
    precision,
    tokens:
      r.cryptoTokenStandards == null
        ? []
        : rows(r.cryptoTokenStandards).map(text),
  }
}
export function detailedConfigs(value: unknown): DetailedConfig[] {
  return rows(value).flatMap((raw) =>
    parseConfigs([raw]).map((config) => {
      const r = object(raw)
      return {
        ...config,
        currencies:
          r.currencies == null ? [] : rows(r.currencies).map(parseCurrency),
        confirmations:
          typeof r.minConfirmationsCount === 'number' &&
          Number.isInteger(r.minConfirmationsCount) &&
          r.minConfirmationsCount > 0
            ? r.minConfirmationsCount
            : undefined,
      }
    }),
  )
}
export function allowedConfigs(all: DetailedConfig[], grade: DetailedConfig[]) {
  const keys = new Set(
    grade
      .filter(
        (r) =>
          r.financeOperationTypeName === 'Add' &&
          (r.merchantCode === '' ||
            (r.crypto && typeof r.merchantCode === 'string')),
      )
      .map(configKey),
  )
  return all
    .filter(
      (r) =>
        r.financeOperationTypeName === 'Add' &&
        (r.merchantCode === '' ||
          (r.crypto && typeof r.merchantCode === 'string')) &&
        keys.has(configKey(r)),
    )
    .sort((a, b) => a.order - b.order)
}
export function networksFor(configs: DetailedConfig[]): Network[] {
  const result: Network[] = [],
    seen = new Set<string>()
  for (const config of configs.filter(
    (c) => c.crypto && c.paymentTypeCode !== 'CryptoPayments',
  ))
    for (const currency of config.currencies)
      for (const token of currency.tokens.length
        ? currency.tokens
        : [undefined]) {
        const key = JSON.stringify([
          configKey(config),
          currency.code,
          token ?? null,
        ])
        if (seen.has(key)) continue
        seen.add(key)
        const name = config.paymentRouteCode || config.paymentTypeCode
        result.push({
          key,
          label: token || name,
          config,
          currency,
          token,
        })
      }
  return result
}
export function parseCountry(value: unknown) {
  const profile = rows(object(value).profiles ?? [])
      .map(object)
      .find((r) => r.type === 'Personal'),
    address = object(profile?.address)
  return typeof address.countryCode === 'string' &&
    /^[A-Z]{2}$/.test(address.countryCode) &&
    typeof address.country === 'string' &&
    address.country
    ? { code: address.countryCode, name: address.country }
    : undefined
}
export function parseTerms(
  fees: unknown,
  range: unknown,
  currency: PaymentCurrency,
  balance: unknown,
  account: Destination,
  rate?: unknown,
): Terms {
  const bounds = object(range),
    min = finite(bounds.min),
    max = finite(bounds.max)
  if (min < 0 || max < min) return invalid()
  const rawFee = rows(fees)[0],
    f = rawFee === undefined ? undefined : object(rawFee)
  const fee = f
    ? {
        currency: parseCurrency(f.currency),
        percent: finite(f.percent),
        constant: finite(f.constant),
        min: finite(f.minValue),
        max:
          f.maxValue == null || f.maxValue === 0
            ? undefined
            : finite(f.maxValue),
      }
    : undefined
  if (
    fee &&
    (fee.currency.code !== currency.code ||
      fee.percent < 0 ||
      fee.constant < 0 ||
      fee.min < 0 ||
      (fee.max !== undefined && fee.max < fee.min))
  )
    throw new AuthError('UNSUPPORTED_FEE')
  const pocket = rows(balance)
    .map(object)
    .find(
      (r) =>
        object(r.currency).code === (account.currency?.code ?? currency.code),
    )
  const available = pocket
    ? finite(pocket.available)
    : account.wallet
      ? 0
      : undefined
  const rateRow = object(rate)
  if (
    rate !== undefined &&
    (rateRow.isRateMissing === true ||
      !(typeof rateRow.rateValue === 'number' && rateRow.rateValue > 0))
  )
    throw new AuthError('RATE_UNAVAILABLE')
  return {
    min,
    max,
    fee,
    available,
    balanceCurrency: account.currency?.code ?? currency.code,
    rate: rate === undefined ? undefined : finite(rateRow.rateValue),
  }
}
export function amountValue(
  value: string,
  currency: PaymentCurrency,
  terms: Terms,
): number {
  const normalized = value.replaceAll(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new AuthError('AMOUNT_REQUIRED')
  if ((normalized.split('.')[1]?.length ?? 0) > currency.precision)
    throw new AuthError('AMOUNT_PRECISION')
  const amount = Number(normalized)
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > Number.MAX_SAFE_INTEGER
  )
    throw new AuthError('AMOUNT_REQUIRED')
  if (
    decimalCanonical(normalized) !==
    decimalCanonical(expandDecimal(amount.toString()))
  )
    throw new AuthError('AMOUNT_PRECISION')
  if (amount < terms.min) throw new AuthError('AMOUNT_MIN')
  if (amount > terms.max) throw new AuthError('AMOUNT_MAX')
  return amount
}
export function feeValue(amount: number, fee?: Fee) {
  if (!fee) return undefined
  return Math.max(
    fee.min,
    Math.min(fee.max ?? Infinity, amount * fee.percent + fee.constant),
  )
}
export function parseAddress(value: unknown): AddressResult {
  const r = object(value)
  return {
    value: text(r.value),
    tag:
      typeof r.paymentTag === 'string' && r.paymentTag
        ? r.paymentTag
        : undefined,
  }
}
export function parseInvoice(value: unknown): Invoice {
  const invoice = object(object(value).invoice),
    body = object(invoice.body)
  const pairs = (v: unknown) =>
    rows(v).map((raw) => {
      const r = object(raw)
      if (
        typeof r.key !== 'string' ||
        typeof r.value !== 'string' ||
        r.key.length > 20000 ||
        r.value.length > 20000
      )
        return invalid()
      return { key: r.key, value: r.value }
    })
  const amount = text(invoice.amount)
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return invalid()
  return {
    header: pairs(invoice.header),
    groups: [
      pairs(body.firstGroup),
      pairs(body.secondGroup),
      pairs(body.thirdGroup),
    ],
    amount,
    currency: text(invoice.currencyCode),
    number: text(invoice.invoiceNumber),
    date: text(invoice.paymentDate),
  }
}
export const contextQuery = (c: DetailedConfig) => ({
  financeOperationTypeName: 'Add',
  merchantCode: c.merchantCode ?? '',
  paymentTypeCode: c.paymentTypeCode,
  ...(c.paymentOptionCode === null
    ? {}
    : { paymentOptionCode: c.paymentOptionCode }),
  ...(c.paymentRouteCode === null
    ? {}
    : { paymentRouteCode: c.paymentRouteCode }),
})

function decimalCanonical(value: string) {
  const [whole, fraction = ''] = value.split('.')
  const digits = whole.replace(/^0+(?=\d)/, '')
  const tail = fraction.replace(/0+$/, '')
  return digits + (tail ? '.' + tail : '')
}
function expandDecimal(value: string) {
  const [coefficient, exponent] = value.toLowerCase().split('e')
  if (!exponent) return coefficient
  const [whole, fraction = ''] = coefficient.split('.'),
    digits = whole + fraction,
    point = whole.length + Number(exponent)
  return point <= 0
    ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length
      ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point)
}

export function feeDescription(fee: Fee, amount?: number): string {
  const format = (n: number) =>
    new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: Math.min(fee.currency.precision, 20),
    }).format(n)
  if (amount !== undefined)
    return format(feeValue(amount, fee)!) + ' ' + fee.currency.code
  if (!fee.percent && !fee.constant && !fee.min) return 'Без комиссии'
  const parts = [
    fee.percent
      ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 8 }).format(
          fee.percent * 100,
        ) + '%'
      : '',
    fee.constant ? format(fee.constant) + ' ' + fee.currency.code : '',
  ].filter(Boolean)
  if (fee.min)
    parts.push('не менее ' + format(fee.min) + ' ' + fee.currency.code)
  if (fee.max !== undefined)
    parts.push('не более ' + format(fee.max) + ' ' + fee.currency.code)
  return parts.join(' · ')
}
