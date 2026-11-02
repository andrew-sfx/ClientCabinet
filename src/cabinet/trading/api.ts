import { AuthError, CabinetApi, object } from '../../auth/api.ts'
import { authConfig } from '../../auth/config.ts'
import type { Session } from '../../auth/session.ts'
import { parseOperations } from '../api.ts'
import { array, numeric, accounts, candidates, products, text, invalid } from './model.ts'
export type CreateRequest = { tradingProductCode: string; currencyCode: string; leverageValue: number; initialAmount: number; agent?: string }
export type Credentials = { number: string; password?: string; investorLogin?: string; investorPassword?: string }
export class TradingApi {
  private session: Session
  private api: CabinetApi
  constructor(session: Session, api = new CabinetApi()) { this.session = session; this.api = api }
  private async request(path: string, method = 'GET', body?: Record<string, unknown>, query: Record<string,string> = {}) {
    const revision = this.session.accountRevision
    const value = await this.session.authenticated(access => {
      if (!this.session.hasSession || revision !== this.session.accountRevision) throw new AuthError('SESSION_EXPIRED')
      return method === 'GET' ? this.api.request(path + '?' + new URLSearchParams({ ...query, domainName: authConfig.domainName }), {}, access, 60000) : this.api.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, domainName: authConfig.domainName }) }, access, 60000)
    })
    if (!this.session.hasSession || revision !== this.session.accountRevision) throw new AuthError('SESSION_EXPIRED')
    return value
  }
  async load() {
    const revision = this.session.accountRevision
    const [config, raw] = await Promise.all([this.request('/trading/tradingproduct/configuration'), this.request('/account')])
    if (!this.session.hasSession || revision !== this.session.accountRevision) throw new AuthError('SESSION_EXPIRED')
    const parsed = products(config), numbers = candidates(raw).map(a => a.number)
    const details = numbers.length ? await this.request('/tradingaccount', 'POST', { accountNumbers: numbers }) : []
    if (!this.session.hasSession || revision !== this.session.accountRevision) throw new AuthError('SESSION_EXPIRED')
    return { products: parsed, accounts: accounts(raw, details, parsed) }
  }
  // Reference module 10519 filters account.number client-side, after fetching User/FinanceOperation pages.
  async history(accountNumber: string, dateFrom: string, dateTo: string) {
    const revision = this.session.accountRevision, rows: ReturnType<typeof parseOperations> = []
    const seen = new Set<string>(); let loaded = 0
    for (let page = 1; page <= 1000; page++) {
      const value = object(await this.request('/user/financeoperation','GET',undefined,{ dateFrom, dateTo, pageNumber:String(page), pageSize:'100' }))
      if (!this.session.hasSession || this.session.accountRevision !== revision) throw new AuthError('SESSION_EXPIRED')
      const data = array(value.data), total = numeric(value.total)
      for (const raw of data) { const r = object(raw); if (object(r.account).number !== accountNumber) continue; const parsed = parseOperations({data:[r]})[0]; if (!seen.has(parsed.id)) { rows.push(parsed); seen.add(parsed.id) } }
      loaded += data.length
      if (data.length === 0 || (total !== undefined ? loaded >= total : data.length < 100)) return rows
    }
    throw new AuthError('HISTORY_LIMIT')
  }
  async periods(accountNumber: string) {
    const r = object(await this.request('/statement/period','GET',undefined,{ accountNumber, pageSize:'100', pageNumber:'1' }))
    return { total: numeric(r.total) ?? invalid(), rows: array(r.statementPeriods).map(value => { const row = object(value); return { name:text(row.periodName) ?? invalid(), from:text(row.dateFrom) ?? invalid(), to:text(row.dateTo) ?? invalid() } }) }
  }
  async statement(accountNumber: string, periodName: string, dateFrom: string) {
    const r = object(await this.request('/statement','GET',undefined,{accountNumber,periodName,dateFrom}))
    return text(r.statement) ?? invalid()
  }
  async create(body: CreateRequest): Promise<Credentials | null> {
    const result = await this.request('/trading/create', 'POST', body)
    if (result === null) return null
    const r = object(result)
    return { number: text(r.accountNumber) ?? invalid(), password: text(r.password), investorLogin: text(r.investorLogin), investorPassword: text(r.investorPassword) }
  }
  leverage(accountNumber: string, leverageValue: number, state?: string) { return this.request('/tradingaccount/leverage', 'PUT', { accountNumber, leverageValue, ...(state ? { state } : {}) }) }
  status(accountNumber: string, status: string, state?: string) { return this.request('/tradingaccount/status', 'PUT', { accountNumber, status, ...(state ? { state } : {}) }) }
  // Reference 2.11/37562, module 2713: MT4 disallowed; MT5 Blocked, others Frozen, then Archived.
  async archive(account: { number: string; platform: string; status: string }) {
    if (account.platform === 'MT4' || /MetaTrader\s*4/i.test(account.platform) || !['Full','Readonly'].includes(account.status)) throw new AuthError('ACCOUNT_STATUS_INVALID')
    const revision = this.session.accountRevision
    await this.status(account.number, account.platform === 'MT5' || /MetaTrader\s*5/i.test(account.platform) ? 'Blocked' : 'Frozen')
    if (!this.session.hasSession || revision !== this.session.accountRevision) throw new AuthError('SESSION_EXPIRED')
    await this.status(account.number,'Archived')
  }
  demoAdd(accountNumber: string, amount: number, currencyCode: string) { return this.request('/tradingaccount/demo/add', 'POST', { accountNumber, amount, currencyCode }) }
  async password(accountNumber: string, state?: string) { const r = object(await this.request('/tradingaccount/password/reset', 'POST', { accountNumber, isInvestorPassword: false, ...(state ? { state } : {}) })); if (typeof r.isSuccess !== 'boolean') return invalid(); return { success: r.isSuccess, password: text(r.password) } }
}
