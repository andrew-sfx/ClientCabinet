import { AuthError, object } from '../../auth/api.ts'
export type Product = { code: string; name: string; platform: string; type: string; demo: boolean; visible: boolean; agreement: boolean; agent: boolean; currencies: string[]; leverages: number[]; transitions: { from: string; to: string }[] }
export type Account = { number: string; product?: Product; productName: string; platform: string; server?: string; created?: string; demo: boolean; status: string; leverage?: number; locked: boolean; balances: { amount: number; blocked: number; code: string; precision: number }[] }
export const invalid = (): never => { throw new AuthError('INVALID_RESPONSE') }
export const array = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid()
export const text = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined
export const numeric = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
function bool(v: unknown): boolean { if (v === true || v === 'True' || v === 'true') return true; if (v === false || v === 'False' || v === 'false') return false; return invalid() }
export function statusTransitions(value: unknown): { from: string; to: string }[] {
  let parsed = value
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return [] } }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap(row => { if (typeof row === 'string') { try { const v = JSON.parse(row); return statusTransitions(Array.isArray(v) ? v : [v]) } catch { return [] } } const r = object(row); return typeof r.from === 'string' && typeof r.to === 'string' && ['Full','Readonly','Blocked','Frozen','Archived'].includes(r.to) ? [{from:r.from,to:r.to}] : [] })
}
export function products(value: unknown): Product[] {
  return array(value).map(raw => { const r = object(raw); return { transitions: statusTransitions(r.ALLOWED_ACCOUNT_STATUS_TRANSITIONS_JSON), code: text(r.code) ?? invalid(), name: text(r.name) ?? text(r.code) ?? invalid(), platform: text(r.tradingPlatformType) ?? '—', type: text(r.tradingProductType) ?? '', demo: bool(r.isDemo), visible: bool(r.isVisible), agreement: r.isAgreementRequired === true, agent: r.allowAgent === true, currencies: array(r.currencies ?? []).map(c => text(object(c).code) ?? invalid()), leverages: array(r.leverages ?? []).map(l => numeric(object(l).value) ?? invalid()) } })
}
export function candidates(value: unknown): (Record<string, unknown> & { number: string; demo: boolean })[] {
  return array(value).map(object).filter(a => object(a.type).name === 'Trading').filter(a => !bool(a.isArchived)).map(a => ({ ...a, number: text(a.number) ?? invalid(), demo: bool(a.isDemo) }))
}
export function accounts(raw: unknown, details: unknown, config: Product[]): Account[] {
  const rows = array(details).map(object)
  return candidates(raw).map(a => {
    const d = rows.find(r => r.accountNumber === a.number) ?? invalid(), leverage = object(d.leverage), platform = object(a.platform), p = object(a.product)
    const product = config.find(c => c.code === p.code)
    return { number: a.number, demo: a.demo, product, productName: text(p.name) ?? product?.name ?? 'Тип не настроен', platform: text(platform.name) ?? product?.platform ?? '—', server: text(platform.address), created: text(a.created), status: text(d.status) ?? 'Неизвестен', leverage: numeric(leverage.value), locked: leverage.isLocked === true, balances: array(d.balances).map(b => { const r = object(b), c = object(r.currency), precision = numeric(c.precision); if (precision === undefined || !Number.isInteger(precision) || precision < 0 || precision > 20) return invalid(); return { amount: Math.min(numeric(r.balance) ?? invalid(), numeric(r.marginFree) ?? invalid()), blocked: numeric(r.blockedAmount) ?? invalid(), code: text(c.code) ?? invalid(), precision } }) }
  })
}
export function groups(rows: Account[], demo: boolean) {
  const result = new Map<string, Account[]>()
  for (const a of rows.filter(a => a.demo === demo).sort((a,b) => a.number.localeCompare(b.number, undefined, { numeric: true }))) { const key = a.product ? a.platform : 'Счета с ограниченной поддержкой'; result.set(key, [...result.get(key) ?? [], a]) }
  return [...result.entries()].sort(([a],[b]) => a === 'Счета с ограниченной поддержкой' ? 1 : b === 'Счета с ограниченной поддержкой' ? -1 : 0)
}
export const statusLabel = (s: string) => ({ Full: 'Полный доступ', Readonly: 'Только чтение', Blocked: 'Заблокирован', Frozen: 'Заблокирован', Archived: 'В архиве' })[s] ?? s
export const blocked = (a: Account) => !['Full','Readonly'].includes(a.status)
