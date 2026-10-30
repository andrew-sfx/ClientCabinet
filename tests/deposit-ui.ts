import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DepositMethods } from '../src/cabinet/deposit/DepositMethods'
import { AuthError } from '../src/auth/api'
import { depositMethods, parseConfigs } from '../src/cabinet/deposit/model'
import '../src/styles.css'
import '../src/cabinet/home.css'

const row = (code: string, order: number, crypto = false) => ({ financeOperationTypeName: 'Add', merchantCode: '', paymentTypeCode: code, paymentOptionCode: code, paymentRouteCode: code, isOpened: true, isVisible: true, order, paymentGroups: crypto ? [{ code: 'CryptoPayments' }] : [] })
const configs = [row('Bitcoin', 0, true), row('FasaPay', 1), row('Moneybookers', 2), row('Neteller', 3), row('CreditDebitCards', 4), row('SyntheticUnknownMethod', 5)]
const scene = new URLSearchParams(location.search).get('scene')
let failed = scene === 'error'
const reader = { async methods(signal: AbortSignal) {
  if (scene === 'loading') return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  if (failed) { failed = false; throw new AuthError('NETWORK') }
  if (scene === 'observed') {
    const observed = [row('Bitcoin', 0, true), row('OTC', 1), row('WireTransfer', 2)]
    return depositMethods(parseConfigs(observed), parseConfigs(observed))
  }
  return scene === 'empty' ? [] : depositMethods(parseConfigs(configs), parseConfigs(configs.slice(0, -1)))
} }
createRoot(document.getElementById('root')!).render(createElement(DepositMethods, { reader, onSessionLost() { throw new Error('Unexpected session loss in synthetic UI') } }))

if (new URLSearchParams(location.search).get('present') === '1') document.getElementById('demo-label')!.hidden = true
if (scene === 'observed') document.getElementById('demo-label')!.textContent = 'Представление проверенного состава · Тестовый транспорт · Синтетическая доступность · Не живой снимок'
