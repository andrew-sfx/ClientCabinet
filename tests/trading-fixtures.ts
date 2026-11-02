import { CabinetApi } from '../src/auth/api.ts'
import { TradingApi } from '../src/cabinet/trading/api.ts'
import { fixture } from './home-fixtures.ts'
export const tradingProducts = [{ code: 'TEST-CASH', name: 'TT_Cash', tradingPlatformType: 'TickTrader', tradingProductType: 'Cash', isDemo: false, isVisible: true, isAgreementRequired: false, allowAgent: true, currencies: [{ code: 'USD', precision: 2 },{ code: 'EUR', precision: 2 }], leverages: [{ value: 30 },{ value: 100 },{ value: 200 }] },{ code: 'TEST-MT5', name: 'Standard', tradingPlatformType: 'MetaTrader 5', tradingProductType: 'Gross', isDemo: false, isVisible: true, isAgreementRequired: false, currencies: [{ code: 'USD', precision: 2 }], leverages: [{ value: 500 }] },{ code: 'TEST-DEMO', name: 'DemoTTCash', tradingPlatformType: 'TickTrader', tradingProductType: 'Cash', isDemo: true, isVisible: true, isAgreementRequired: false, currencies: [{ code: 'USD', precision: 2 }], leverages: [{ value: 100 }] }]
export const tradingAccounts = [['TEST-1001','TEST-CASH','TickTrader'],['TEST-1002','TEST-CASH','TickTrader'],['TEST-1003','TEST-CASH','TickTrader'],['TEST-1004','TEST-CASH','TickTrader'],['TEST-2001','TEST-MT5','MetaTrader 5'],['TEST-DEMO-1','TEST-DEMO','TickTrader'],['TEST-LIMITED','MISSING','TickTrader']].map(([number,code,platform]) => ({ number, type: { name: 'Trading' }, product: { code, name: code === 'TEST-MT5' ? 'Standard' : code === 'MISSING' ? 'Тип не настроен' : 'TT_Cash' }, platform: { name: platform, address: 'trade.example.invalid' }, isDemo: code === 'TEST-DEMO', isArchived: false, created: '2026-08-12T10:00:00Z' }))
export const tradingDetails = tradingAccounts.map((a,i) => ({ accountNumber: a.number, status: i === 2 ? 'Readonly' : i === 3 ? 'Blocked' : 'Full', leverage: { value: i === 4 ? 500 : 100, isLocked: false }, balances: [{ balance: i === 0 ? 1000 : i === 1 ? 5812.35 : 0, marginFree: i === 0 ? 1000 : i === 1 ? 5812.35 : 0, blockedAmount: i === 1 ? 120 : 0, currency: { code: 'USD', precision: 2 } },...(i === 1 ? [{ balance: 1000, marginFree: 1000, blockedAmount: 0, currency: { code: 'EUR', precision: 2 } }] : [])] }))
export async function tradingFixture(mode = 'list') {
  const base = fixture(); await base.session.check()
  const state = { mode, calls: [] as { path: string; method: string; body: unknown }[] }
  const api = new TradingApi(base.session,new CabinetApi(async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? 'GET', body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    state.calls.push({ path, method, body })
    if (state.mode === 'loading') return new Promise<Response>(() => {})
    if (state.mode === 'error') return new Response('{}',{status:503})
    if (state.mode === 'mfa' && path === '/tradingaccount/leverage') return new Response(JSON.stringify({error:{innerErrors:[{code:'MULTI_FACTOR_AUTHENTICATION_REQUIRED',details:{state:'synthetic-mfa'}}]}}),{status:400})
    let data: unknown
    if (path === '/trading/tradingproduct/configuration') data = tradingProducts
    else if (path === '/account') data = state.mode === 'empty' ? [] : tradingAccounts
    else if (path === '/tradingaccount') data = tradingDetails
    else if (path === '/trading/create') data = { accountNumber:'TEST-CREATED' }
    else if (path === '/tradingaccount/password/reset') data = { isSuccess:true }
    else if (path === '/user/financeoperation') data = { data: [{id:'TEST-OP',account:{number:'TEST-1001'},type:{name:'Add'},status:{code:'Succeed'},paymentOptionType:{option:{name:'С основного счёта'}},amount:1000,fee:0,currency:{code:'USD',precision:2},created:'2026-10-30T10:00:00Z'}],total:1 }
    else if (path === '/statement/period') data = {statementPeriods:[{periodName:'Monthly',dateFrom:'2026-09-01T00:00:00Z',dateTo:'2026-09-30T23:59:59Z'}],total:1}
    else if (path === '/statement') data = {statement:'<html><body>Synthetic statement</body></html>'}
    else if (path === '/tradingaccount/demo/add') data = null
    else if (path === '/tradingaccount/leverage' || path === '/tradingaccount/status') data = null
    else throw new Error('Unexpected synthetic path: '+path)
    return new Response(JSON.stringify(data), {status:200})
  }))
  return { ...base, api, tradingState: state }
}
