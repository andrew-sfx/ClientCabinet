import type { Balance, BalanceView } from './api.ts'

const names: Record<string, string> = {
  USD: 'Доллар США', EUR: 'Евро', GBP: 'Фунт стерлингов', RUB: 'Российский рубль', CHF: 'Швейцарский франк',
  AUD: 'Австралийский доллар', CAD: 'Канадский доллар', JPY: 'Японская иена', CNY: 'Китайский юань', BTC: 'Биткоин', ETH: 'Ethereum', USDT: 'Tether',
  USDC: 'USD Coin', LTC: 'Litecoin', XRP: 'XRP',
}
export const currencyName = (code: string) => Object.hasOwn(names, code) ? names[code] : undefined
export const balanceTotal = (balance: Balance) => balance.available + balance.reserved
export const hasFunds = (balance: Balance) => balance.available !== 0 || balance.reserved !== 0
export function balanceOptions(view: BalanceView) {
  return view.balances.filter(hasFunds).sort((a, b) => {
    const ac = a.currency.code, bc = b.currency.code
    if (ac === view.currency?.code) return -1
    if (bc === view.currency?.code) return 1
    const av = view.converted[ac], bv = view.converted[bc]
    if (av === undefined || bv === undefined) return av === undefined && bv === undefined ? ac.localeCompare(bc) : av === undefined ? 1 : -1
    return bv - av || ac.localeCompare(bc)
  })
}
export function currencyGroups(balances: Balance[]) {
  const fiat = new Set(Intl.supportedValuesOf('currency'))
  const sorted = [...balances].sort((a, b) => Number(balanceTotal(a) === 0) - Number(balanceTotal(b) === 0) || balanceTotal(b) - balanceTotal(a) || a.currency.code.localeCompare(b.currency.code))
  return [
    { name: 'Валюты', balances: sorted.filter(b => fiat.has(b.currency.code)) },
    { name: 'Криптовалюты', balances: sorted.filter(b => !fiat.has(b.currency.code)) },
  ].filter(group => group.balances.length > 0)
}
export function excludedLabel(missing: string[]) {
  return missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'не учтён' : 'не учтены'}` : ''
}
