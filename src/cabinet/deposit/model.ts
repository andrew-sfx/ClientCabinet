import { AuthError, object } from '../../auth/api.ts'

export interface PaymentConfig {
  financeOperationTypeName: string
  merchantCode: string | null
  paymentTypeCode: string
  paymentOptionCode: string | null
  paymentRouteCode: string | null
  isOpened: boolean
  isVisible: boolean
  order: number
  crypto: boolean
}
export interface DepositMethod {
  key: string
  name: string
  crypto: boolean
  available: boolean
  icon?: 'card'
  kind?: 'crypto' | 'wire'
}
const invalid = (): never => {
  throw new AuthError('INVALID_RESPONSE')
}
export function parseConfigs(value: unknown): PaymentConfig[] {
  if (!Array.isArray(value)) return invalid()
  return value.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      return invalid()
    const row = object(raw)
    const text = (key: string) =>
      typeof row[key] === 'string' && row[key]
        ? (row[key] as string)
        : invalid()
    if (row.isOpened !== true || row.isVisible !== true) return []
    if (
      !Number.isInteger(row.order) ||
      (row.merchantCode !== null && typeof row.merchantCode !== 'string') ||
      (row.paymentGroups != null && !Array.isArray(row.paymentGroups))
    )
      return invalid()
    const groups = (row.paymentGroups ?? []) as unknown[]
    if (groups.some((group) => typeof object(group).code !== 'string'))
      return invalid()
    const type = text('paymentTypeCode')
    const nullableCode = (value: unknown) =>
      value == null ? null : typeof value === 'string' ? value : invalid()
    // Preserve null and empty strings in the grade tuple; never broaden permission by normalizing to type.
    const option = nullableCode(row.paymentOptionCode)
    const route = nullableCode(row.paymentRouteCode)
    return [
      {
        financeOperationTypeName: text('financeOperationTypeName'),
        merchantCode: row.merchantCode as string | null,
        paymentTypeCode: type,
        paymentOptionCode: option,
        paymentRouteCode: route,
        isOpened: row.isOpened,
        isVisible: row.isVisible,
        order: row.order as number,
        crypto: groups.some((group) => object(group).code === 'CryptoPayments'),
      },
    ]
  })
}
// Public reference ru/payment.json, Add.*.title; values verified 30.10.2026.
const labels: Record<string, string> = {
  Moneybookers: 'Skrill',
  CreditDebitCards: 'Банковские карты',
  WireTransfer: 'Банковский перевод',
}
export const configKey = (row: PaymentConfig) =>
  JSON.stringify([
    row.financeOperationTypeName,
    row.merchantCode,
    row.paymentTypeCode,
    row.paymentOptionCode,
    row.paymentRouteCode,
  ])
const visible = (row: PaymentConfig) =>
  row.financeOperationTypeName === 'Add' &&
  row.isOpened &&
  row.isVisible &&
  (row.merchantCode === '' ||
    (row.crypto && typeof row.merchantCode === 'string'))
export function depositMethods(
  configs: PaymentConfig[],
  grades: PaymentConfig[],
): DepositMethod[] {
  const allowed = new Set(grades.filter(visible).map(configKey))
  const sorted = configs
    .filter(visible)
    .sort(
      (a, b) =>
        a.order - b.order || a.paymentTypeCode.localeCompare(b.paymentTypeCode),
    )
  const result: DepositMethod[] = [],
    seen = new Set<string>()
  for (const row of sorted) {
    if (['Transfer', 'Exchange'].includes(row.paymentTypeCode)) continue
    const crypto = row.crypto || row.paymentTypeCode === 'CryptoPayments'
    const key = crypto ? 'crypto' : configKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      key,
      name: crypto
        ? 'Crypto'
        : (labels[row.paymentTypeCode] ?? row.paymentTypeCode),
      crypto,
      kind: crypto
        ? 'crypto'
        : row.paymentTypeCode === 'WireTransfer'
          ? 'wire'
          : undefined,
      icon:
        !crypto && row.paymentTypeCode === 'CreditDebitCards'
          ? 'card'
          : undefined,
      available: crypto
        ? sorted.some(
            (item) =>
              (item.crypto || item.paymentTypeCode === 'CryptoPayments') &&
              allowed.has(configKey(item)),
          )
        : allowed.has(configKey(row)),
    })
  }
  return result
}
