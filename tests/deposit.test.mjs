import test from 'node:test'
import assert from 'node:assert/strict'
import { depositMethods, parseConfigs } from '../src/cabinet/deposit/model.ts'
import { DepositApi } from '../src/cabinet/deposit/api.ts'
import { AuthError } from '../src/auth/api.ts'
import { fixture } from './home-fixtures.ts'
const row = (code, order = 0, extra = {}) => ({ financeOperationTypeName: 'Add', merchantCode: '', paymentTypeCode: code, paymentOptionCode: code, paymentRouteCode: code, isOpened: true, isVisible: true, order, paymentGroups: [], ...extra })
test('filters closed/hidden/merchant/non-Add and internal actions, orders server rows and preserves unknown code', () => {
 const rows = [row('Unknown', 8), row('FasaPay', 1), row('Hidden', 0, {isVisible:false}), row('Closed',0,{isOpened:false}),row('Merchant',0,{merchantCode:'other'}),row('NullMerchant',0,{merchantCode:null}),row('Withdraw',0,{financeOperationTypeName:'Withdraw'}),row('Transfer'),row('Exchange')]
 assert.deepEqual(depositMethods(parseConfigs(rows),parseConfigs(rows)).map(x=>x.name),['FasaPay','Unknown'])
})
test('crypto aggregates once with any allowed child; grade matches full tuple; empty grade denies', () => {
 const rows = [row('BTC',2,{paymentGroups:[{code:'CryptoPayments'}]}),row('ETH',3,{paymentGroups:[{code:'CryptoPayments'}]}),row('Route',4),row('Route',5,{paymentRouteCode:'alternate'})]
 const methods=depositMethods(parseConfigs(rows),parseConfigs([rows[1],rows[3]]))
 assert.deepEqual(methods.map(x=>[x.name,x.available]),[['Crypto',true],['Route',false],['Route',true]])
 assert.ok(depositMethods(parseConfigs(rows),[]).every(x=>!x.available))
})
test('invalid/missing fields fail closed, null groups accepted, duplicate tuple rendered once',()=>{
 for(const input of [{},[null],[3],[[]],[row('x',0,{order:NaN})],[row('x',0,{paymentGroups:[{}]})]])assert.throws(()=>parseConfigs(input),{code:'INVALID_RESPONSE'})
 assert.equal(depositMethods(parseConfigs([row('x',0,{paymentGroups:null}),row('x')]),[]).length,1)
 assert.deepEqual(parseConfigs([row('x',0,{isOpened:undefined})]),[])
 assert.equal(parseConfigs([row('x',0,{paymentOptionCode:null,paymentRouteCode:null})])[0].paymentRouteCode,null)
})
test('two authenticated GETs use configured domain; grade failure rejects all; logout and abort reject stale data',async()=>{
 const f=fixture();await f.session.check();const calls=[]
 const fetcher=async(url,init)=>{calls.push({url:new URL(url),init});return new Response(JSON.stringify([row('Unknown')]))}
 const api=new DepositApi(f.session,fetcher);assert.equal((await api.methods(new AbortController().signal))[0].name,'Unknown')
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.pathname==='/paymentsystem/configuration'&&c.url.searchParams.get('financeOperationTypeName')==='Add'&&c.url.searchParams.get('domainName')==='client.soft-fx.com'&&c.init.headers.get('Authorization')?.startsWith('Bearer ')&&!c.init.body))
 assert.equal(calls.filter(c=>c.url.searchParams.get('checkGrade')==='true').length,1)
 await assert.rejects(new DepositApi(f.session,async(url)=>new URL(url).searchParams.has('checkGrade')?new Response('{}',{status:503}):new Response('[]')).methods(new AbortController().signal),{code:'UNAVAILABLE'})
 const controller=new AbortController();let release;const gate=new Promise(r=>release=r)
 const pending=new DepositApi(f.session,async()=>{await gate;return new Response('[]')}).methods(controller.signal);controller.abort();release();await assert.rejects(pending)
 const noSession={accountRevision:1,hasSession:false,authenticated(){throw new AuthError('SESSION_EXPIRED')}}
 await assert.rejects(new DepositApi(noSession,fetcher).methods(new AbortController().signal),{code:'SESSION_EXPIRED'})
 f.session.clear()
})
test('existing session refresh retries a 401 and returns methods',async()=>{
 const f=fixture();await f.session.check();let attempts=0
 const api=new DepositApi(f.session,async(_url,init)=>{attempts++;return init.headers.get('Authorization')==='Bearer synthetic-old'?new Response('{}',{status:401}):new Response(JSON.stringify([row('x')]))})
 assert.equal((await api.methods(new AbortController().signal)).length,1);assert.ok(attempts>=3);assert.equal(f.state.refreshes,1);f.session.clear()
})

test('grade keeps null, explicit empty, and type route identities distinct',()=>{
 const rows=[row('x',0,{paymentOptionCode:null,paymentRouteCode:null}),row('x',1,{paymentOptionCode:'',paymentRouteCode:''}),row('x',2)]
 assert.deepEqual(depositMethods(parseConfigs(rows),parseConfigs([rows[2]])).map(x=>x.available),[false,false,true])
})

test('public reference localization labels only verified known codes',()=>{
 const rows=[row('Moneybookers'),row('CreditDebitCards',1),row('Unknown',2)]
 assert.deepEqual(depositMethods(parseConfigs(rows),parseConfigs(rows)).map(x=>x.name),['Skrill','Банковские карты','Unknown'])
})
test('logout while configuration is pending rejects its late result',async()=>{
 const f=fixture();await f.session.check();let release;const gate=new Promise(r=>release=r)
 const pending=new DepositApi(f.session,async()=>{await gate;return new Response(JSON.stringify([row('x')]))}).methods(new AbortController().signal)
 f.session.clear();release();await assert.rejects(pending,{code:'SESSION_EXPIRED'})
})

test('fetch is invoked without a class receiver, as required by browser native fetch',async()=>{
 const f=fixture();await f.session.check()
 const fetcher=async function(){assert.equal(this,undefined);return new Response('[]')}
 assert.deepEqual(await new DepositApi(f.session,fetcher).methods(new AbortController().signal),[]);f.session.clear()
})
