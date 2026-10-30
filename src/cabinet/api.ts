import { AuthError, CabinetApi, object } from '../auth/api.ts'
import type { AccountSummary } from '../auth/api.ts'
import { authConfig } from '../auth/config.ts'
import type { Session } from '../auth/session.ts'

export interface Currency { code: string; precision: number }
export interface Balance { available: number; reserved: number; currency: Currency; defaultCurrency?: string }
export interface CurrencyRate { currencyFrom: string; currencyTo: string; value: number }
export interface BalanceView {
  balances: Balance[]; currency?: Currency; available: number; reserved: number; total: number; missing: string[]
  converted: Record<string, number>
}
const totalsSetting = 'PORTAL_WEB_CURRENCY_OF_TOTALS'
export interface Operation {
  id: string; type: string; typeCode?: string; paymentTypeCode?: string; positive?: boolean; method: string; created?: string
  status: string; tone: 'ok' | 'wait' | 'bad' | 'neutral'; amount?: number; fee?: number; currency: Currency; account?: string
}
export interface TradingAccount {
  number: string; platform?: string; product?: string; leverage?: number; inactive: boolean; readonly: boolean
  balances: { amount: number; currency: Currency }[]
}
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const invalid = (): never => { throw new AuthError('INVALID_RESPONSE') }
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : invalid()
function currency(value: unknown): Currency {
  const item = object(value), code = text(item.code), precision = number(item.precision)
  if (!code || precision === undefined || !Number.isInteger(precision) || precision < 0 || precision > 20) return invalid()
  return { code, precision }
}
// Names/codes from the reference build 2.11/37562. Unknown values keep the server label.
const types: Record<string, string> = { Add: 'Пополнение', Withdraw: 'Вывод', Notify: 'Уведомление' }
const statuses: Record<string, [string, Operation['tone']]> = {
  Succeed: ['Выполнено', 'ok'], Pending: ['В ожидании', 'wait'], 'In progress': ['В обработке', 'wait'],
  Failed: ['Ошибка', 'bad'], Rejected: ['Отклонено', 'bad'], Cancelled: ['Отменено', 'bad'], Recreated: ['Создано повторно', 'neutral'],
}
export function parseBalances(value: unknown): Balance[] {
  return array(value).map(raw => {
    const item = object(raw), available = number(item.available), reserved = number(item.reserved)
    if (available === undefined || reserved === undefined) return invalid()
    return { available, reserved, currency: currency(item.currency), defaultCurrency: text(item.defaultDomainCurrencyCode) }
  })
}
export function displayCurrency(balances: Balance[], setting?: string) {
  const configured = balances.find(b => b.currency.code === setting)
  if (configured) return configured.currency
  const codes = new Set(balances.map(b => b.defaultCurrency).filter(Boolean))
  if (codes.size !== 1) return undefined
  return balances.find(b => b.currency.code === [...codes][0])?.currency
}
export function balanceView(balances: Balance[], selected: Currency | undefined, rates: CurrencyRate[]): BalanceView {
  let available = 0, reserved = 0, total = 0
  const missing: string[] = []
  const converted: Record<string, number> = Object.create(null) as Record<string, number>
  for (const balance of balances) {
    const rate = balance.currency.code === selected?.code ? 1
      : rates.find(r => r.currencyFrom === balance.currency.code && r.currencyTo === selected?.code)?.value
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      if (balance.available !== 0 || balance.reserved !== 0) missing.push(balance.currency.code)
      continue
    }
    available += balance.available * rate
    reserved += balance.reserved * rate
    total += (balance.available + balance.reserved) * rate
    converted[balance.currency.code] = (balance.available + balance.reserved) * rate
  }
  return { balances, currency: selected, available, reserved, total, missing, converted }
}
function optionalFailure(error: unknown) {
  // A settings/FX outage must not swallow logout or an account switch.
  if (error instanceof AuthError && error.code === 'SESSION_EXPIRED') throw error
}
export function parseOperations(value: unknown): Operation[] {
  return array(object(value).data).slice(0, 5).map(raw => {
    const item = object(raw), type = object(item.type), status = object(item.status), payment = object(item.paymentOptionType)
    const id = text(item.id), typeName = text(type.name), statusName = text(status.name), code = text(status.code)
    if (!id) return invalid()
    const known = code && Object.hasOwn(statuses, code) ? statuses[code] : undefined
    const positive = object(type.balanceOperationType).isPositive
    return {
      id, type: typeName ? Object.hasOwn(types, typeName) ? types[typeName] : typeName : '—', positive: typeof positive === 'boolean' ? positive : undefined,
      typeCode: typeName, paymentTypeCode: text(object(payment.type).name),
      method: text(object(payment.option).name) ?? text(object(payment.type).name) ?? '—', created: text(item.created),
      status: known?.[0] ?? statusName ?? code ?? '—', tone: known?.[1] ?? 'neutral',
      amount: number(item.amount), fee: number(item.fee), currency: currency(item.currency), account: text(object(item.account).number),
    }
  })
}
const isFalse = (value: unknown) => value === false || value === 'False' || value === 'false'
export function realAccountNumbers(summary: AccountSummary, details: unknown): string[] {
  if (!summary.accounts) return invalid()
  if (summary.accounts.some(a => !a.accountNumber)) return invalid()
  const candidates = summary.accounts.filter(a => a.accountNumber !== summary.mainAccountNumber)
  if (candidates.some(a => !a.accountNumber)) return invalid()
  const rows = array(details).map(object)
  // Summary.type has no documented enum or demo flag. Positively confirm via /account,
  // as the reference does. Missing flags are NOT evidence of a real account.
  return candidates.flatMap(candidate => {
    const account = rows.find(row => row.number === candidate.accountNumber)
    if (!account || !text(object(account.type).name)) return invalid()
    if (object(account.type).name !== 'Trading') return []
    const knownBoolean = (value: unknown) => isFalse(value) || value === true || value === 'True' || value === 'true'
    if (!knownBoolean(account.isDemo) || !knownBoolean(account.isArchived)) return invalid()
    return isFalse(account.isDemo) && isFalse(account.isArchived) ? [candidate.accountNumber!] : []
  })
}
export class HomeApi {
  private api: CabinetApi
  private session: Session
  constructor(session: Session, api = new CabinetApi()) { this.session = session; this.api = api }
  private assertCurrent(revision: number) {
    if (!this.session.hasSession || this.session.accountRevision !== revision) throw new AuthError('SESSION_EXPIRED')
  }
  private get(path: string, query: Record<string, string> = {}) {
    return this.session.authenticated(access => this.api.request(path + '?' + new URLSearchParams({ ...query, domainName: authConfig.domainName }), {}, access))
  }
  async profile(): Promise<AccountSummary> {
    if (!await this.session.check()) throw new AuthError('SESSION_EXPIRED')
    return this.session.summary ?? invalid()
  }
  async balance(summary: AccountSummary): Promise<Balance[]> {
    if (!summary.mainAccountNumber) return invalid()
    return parseBalances(await this.get('/user/account/balance', { account: summary.mainAccountNumber }))
  }
  async balanceSummary(summary: AccountSummary): Promise<BalanceView> {
    const revision = this.session.accountRevision
    const [balances, setting] = await Promise.all([this.balance(summary), this.setting()])
    this.assertCurrent(revision)
    const selected = displayCurrency(balances, setting)
    const rates = selected ? await this.rates(selected.code) : []
    this.assertCurrent(revision)
    return balanceView(balances, selected, rates)
  }
  private async setting(): Promise<string | undefined> {
    try {
      const settings = array(await this.get('/user/setting', { keys: totalsSetting })).map(object)
      return text(settings.find(s => s.key === totalsSetting)?.value)
    } catch (error) { optionalFailure(error); return undefined }
  }
  async rates(code: string): Promise<CurrencyRate[]> {
    try {
      const response = await this.session.authenticated(access => this.api.post('/currencyrates', {
        domainName: authConfig.domainName, date: new Date().toISOString(), currencyCodesTo: [code],
      }, access))
      return array(response).map(raw => {
        const row = object(raw), from = text(row.currencyFrom), to = text(row.currencyTo), value = number(row.value)
        if (!from || !to || value === undefined || value <= 0) return invalid()
        return { currencyFrom: from, currencyTo: to, value }
      })
    } catch (error) { optionalFailure(error); return [] }
  }
  async selectCurrency(balances: Balance[], code: string): Promise<BalanceView> {
    const revision = this.session.accountRevision
    const selected = balances.find(b => b.currency.code === code)?.currency
    if (!selected) return invalid()
    await this.session.authenticated(access => this.api.request('/user/setting', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainName: authConfig.domainName, settings: [{ key: totalsSetting, value: code }] }),
      }, access))
    this.assertCurrent(revision)
    const rates = await this.rates(code)
    this.assertCurrent(revision)
    return balanceView(balances, selected, rates)
  }
  async operations(): Promise<Operation[]> {
    // Dates are optional in Swagger. No unverified calendar window is invented.
    return parseOperations(await this.get('/user/financeoperation', { pageNumber: '1', pageSize: '5' }))
  }
  async trading(summary: AccountSummary): Promise<TradingAccount[]> {
    if (!summary.accounts) return invalid()
    if (summary.accounts.some(a => !a.accountNumber)) return invalid()
    if (!summary.accounts.length || summary.accounts.every(a => a.accountNumber === summary.mainAccountNumber)) return []
    const numbers = realAccountNumbers(summary, await this.get('/account'))
    if (!numbers.length) return []
    const response = await this.session.authenticated(access => this.api.post('/tradingaccount', { domainName: authConfig.domainName, accountNumbers: numbers }, access, 60000))
    const rows = array(response).map(object)
    return numbers.map(accountNumber => {
      const row = rows.find(a => a.accountNumber === accountNumber)
      if (!row) return invalid()
      const account = summary.accounts!.find(a => a.accountNumber === accountNumber)!
      return {
        number: accountNumber, platform: account.platformType, product: account.productCode ?? account.name,
        leverage: number(object(row.leverage).value), inactive: !['Full', 'Readonly'].includes(String(row.status)), readonly: row.readonly === true,
        balances: array(row.balances).map(raw => { const b = object(raw), amount = number(b.balance); return { amount: amount ?? invalid(), currency: currency(b.currency) } }),
      }
    })
  }
}
export function money(amount: number | undefined, _cur: Currency, fixed = false) {
  // API precision remains available to calculations; display has its own policy.
  void _cur
  if (amount === undefined) return '—'
  const sign = amount < 0 ? '−' : ''
  const formatted = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(amount)).replaceAll('\u00a0', ' ')
  if (fixed) return sign + formatted
  if (amount !== 0 && formatted === '0,00') return sign + '< 0,01'
  return sign + formatted.replace(/,00$/, '')
}
export function feeLabel(amount: number | undefined, cur: Currency, detail = false) {
  return amount === 0 ? detail ? 'Без комиссии' : '—' : amount === undefined ? '—' : `${money(amount, cur)} ${cur.code}`
}
export function signedAmount(operation: Operation) {
  if (operation.amount === undefined) return '—'
  const sign = operation.positive === true ? '+' : operation.positive === false ? '−' : ''
  return sign + money(operation.positive === undefined ? operation.amount : Math.abs(operation.amount), operation.currency) + ' ' + operation.currency.code
}
export function dateLabel(value: string | undefined, now = new Date()) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  const date = new Date(value), yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate()
  const day = sameDay(now) ? 'Сегодня' : sameDay(yesterday) ? 'Вчера' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  return `${day}, ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)}`
}
export function identity(summary: AccountSummary) {
  const name = [summary.firstName, summary.lastName].filter(Boolean).join(' ') || 'Личный кабинет'
  const initials = [summary.firstName?.[0], summary.lastName?.[0]].filter(Boolean).join('') || summary.email?.slice(0, 2) || 'ЛК'
  const [local, domain] = (summary.email ?? '').split('@')
  return { name, initials: initials.toLocaleUpperCase('ru'), email: domain ? `${local.slice(0, 2)}•••@${domain}` : '—' }
}
