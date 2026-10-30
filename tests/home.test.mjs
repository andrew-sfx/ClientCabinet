import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthError, CabinetApi } from '../src/auth/api.ts'
import { Session, SESSION_EPOCH_KEY, SESSION_KEY } from '../src/auth/session.ts'
import { HomeApi, balanceView, dateLabel, displayCurrency, feeLabel, identity, money, parseBalances, parseOperations, realAccountNumbers, signedAmount } from '../src/cabinet/api.ts'
import { balanceOptions, currencyGroups, currencyName, excludedLabel } from '../src/cabinet/balance-options.ts'
import { balances, fixture, operations, summary, usd } from './home-fixtures.ts'

test('home reuses summary, requests 1/5 without dates, excludes demo/archive before trading details', async () => {
  const f = fixture(); await f.session.check()
  assert.equal(f.session.summary.firstName, summary.firstName)
  const [balance, history, accounts] = await Promise.all([f.home.balance(f.session.summary), f.home.operations(), f.home.trading(f.session.summary)])
  assert.equal(balance.length, 3); assert.equal(history.length, 5); assert.equal(accounts.length, 2)
  assert.equal(accounts[1].inactive, true)
  assert.equal(f.state.calls.filter(c => c.path === '/user/account/summary').length, 1)
  const op = f.state.calls.find(c => c.path === '/user/financeoperation')
  assert.deepEqual(Object.fromEntries(op.query), { pageNumber: '1', pageSize: '5', domainName: 'client.soft-fx.com' })
  assert.deepEqual(f.state.calls.find(c => c.path === '/tradingaccount').body, { domainName: 'client.soft-fx.com', accountNumbers: ['TEST-1001', 'TEST-1002'] })
  assert.ok(f.state.calls.every(c => c.access === 'Bearer synthetic-old'))
  assert.ok(!f.storage.getItem(SESSION_KEY).includes('Анна'))
})
test('empty successful arrays produce a new client, without inventing a currency', async () => {
  const f = fixture('new'); await f.session.check()
  assert.deepEqual(await Promise.all([f.home.balance(f.session.summary), f.home.operations(), f.home.trading(f.session.summary)]), [[], [], []])
  assert.equal(displayCurrency([]), undefined)
  assert.ok(!f.state.calls.some(c => c.path === '/tradingaccount' || c.path === '/account'))
})
for (const [mode, failed] of [['balance-error', 0], ['operations-error', 1], ['accounts-error', 2]]) test(mode + ' does not hide other independent data', async () => {
  const f = fixture(mode); await f.session.check()
  const values = await Promise.allSettled([f.home.balance(f.session.summary), f.home.operations(), f.home.trading(f.session.summary)])
  assert.deepEqual(values.map(v => v.status), [0, 1, 2].map(i => i === failed ? 'rejected' : 'fulfilled'))
  assert.equal(f.state.refreshes, 0)
})
test('parallel 401 loading shares one refresh, then each request retries once', async () => {
  const f = fixture('401'); await f.session.check()
  const result = await Promise.all([f.home.balance(f.session.summary), f.home.operations(), f.home.trading(f.session.summary)])
  assert.equal(f.state.refreshes, 1); assert.equal(result[1].length, 5)
  for (const path of ['/user/account/balance', '/user/financeoperation', '/account']) assert.equal(f.state.calls.filter(c => c.path === path).length, 2)
})
test('failed refresh invalidates the session and summary during home loading', async () => {
  const f = fixture('expired'); await f.session.check()
  const result = await Promise.allSettled([f.home.balance(f.session.summary), f.home.operations(), f.home.trading(f.session.summary)])
  assert.ok(result.every(r => r.status === 'rejected' && r.reason.code === 'SESSION_EXPIRED'))
  assert.equal(f.session.hasSession, false); assert.equal(f.session.summary, undefined)
})
test('late 401 for old access does not rotate a newly refreshed token again', async () => {
  const f = fixture(); let release
  const old = f.session.authenticated(async token => { if (token === 'synthetic-old') { await new Promise(r => { release = r }); throw new AuthError('UNAUTHORIZED', 401) } return 'late-success' })
  f.state.mode = '401'; await f.home.operations(); release()
  assert.equal(await old, 'late-success'); assert.equal(f.state.refreshes, 1)
})
test('late successful data after logout cannot return or repopulate summary', async () => {
  const f = fixture(); await f.session.check(); let release
  const pending = f.session.authenticated(() => new Promise(r => { release = r }))
  await f.session.logout(); release('stale data')
  await assert.rejects(pending, { code: 'SESSION_EXPIRED' }); assert.equal(f.session.summary, undefined)
})
test('late request from prior account cannot clear the new account session', async () => {
  const f = fixture(); await f.session.check(); let release
  const pending = f.session.authenticated(async () => { await new Promise(r => { release = r }); throw new AuthError('OLD_401', 401) })
  f.storage.setItem(SESSION_EPOCH_KEY, 'synthetic-other-account')
  f.storage.setItem(SESSION_KEY, JSON.stringify({ access: 'other', refresh: 'other-refresh', expiresAt: Date.now() + 3600000 }))
  release(); await assert.rejects(pending, { code: 'SESSION_EXPIRED' })
  assert.equal(f.session.hasSession, true); assert.equal(f.session.summary, undefined)
})
test('proactive refresh followed by 401 fails closed without a second refresh', async () => {
  const f = fixture(); f.storage.setItem(SESSION_KEY, JSON.stringify({ access: 'synthetic-old', refresh: 'synthetic-refresh', expiresAt: Date.now() }))
  await assert.rejects(f.session.authenticated(async () => { throw new AuthError('UNAUTHORIZED', 401) }), { code: 'SESSION_EXPIRED' })
  assert.equal(f.state.refreshes, 1); assert.equal(f.session.hasSession, false)
})
test('unknown operation/status preserves server text, neutral color, and sign comes only from isPositive', () => {
  const op = { ...operations[0], type: { name: 'Server new type', balanceOperationType: { isPositive: false } }, status: { code: 'NEW', name: 'Server new status' }, isStatusFinal: true }
  const [parsed] = parseOperations({ data: [op] })
  assert.equal(parsed.type, 'Server new type'); assert.equal(parsed.status, 'Server new status'); assert.equal(parsed.tone, 'neutral')
  assert.equal(parsed.typeCode, 'Server new type'); assert.equal(parsed.paymentTypeCode, undefined)
  assert.ok(signedAmount(parsed).startsWith('−')); assert.ok(signedAmount({ ...parsed, positive: undefined }).startsWith('5'))
  assert.equal(parseOperations({ data: [{ ...op, type: { name: 'constructor' } }] })[0].type, 'constructor')
})
test('operation codes survive parsing independently of unchanged type and method labels', () => {
  for (const [typeCode, label] of [['Add', 'Пополнение'], ['Withdraw', 'Вывод'], ['Server new type', 'Server new type']]) {
    for (const paymentTypeCode of ['Transfer', 'Exchange', 'Server new payment']) {
      const [op] = parseOperations({ data: [{ ...operations[0], type: { name: typeCode }, paymentOptionType: { type: { name: paymentTypeCode }, option: { name: 'Способ сервера' } } }] })
      assert.equal(op.typeCode, typeCode); assert.equal(op.paymentTypeCode, paymentTypeCode)
      assert.equal(op.type, label); assert.equal(op.method, 'Способ сервера')
    }
  }
  const [missing] = parseOperations({ data: [{ ...operations[0], type: null, paymentOptionType: null }] })
  assert.equal(missing.typeCode, undefined); assert.equal(missing.paymentTypeCode, undefined)
  assert.equal(missing.type, '—'); assert.equal(missing.method, '—')
})
test('display precision is capped at two digits; null fee is not zero', () => {
  assert.equal(money(123, { code: 'JPY', precision: 0 }), '123')
  assert.equal(money(1.234, { code: 'KWD', precision: 3 }), '1,23')
  assert.equal(money(0.00000001, { code: 'BTC', precision: 8 }), '< 0,01')
  const [op] = parseOperations({ data: [{ ...operations[0], fee: null }] })
  assert.equal(money(op.fee, usd), '—')
})
test('missing or unknown setting falls back only to a known default currency', () => {
  assert.equal(displayCurrency(parseBalances(balances)).code, 'USD')
  assert.equal(displayCurrency(parseBalances(balances.slice(1))), undefined)
  assert.equal(displayCurrency(parseBalances([{ ...balances[0], defaultDomainCurrencyCode: null }])), undefined)
})
test('invalid financial responses do not become empty data or invented amounts', () => {
  for (const bad of [null, {}, [{ ...balances[0], available: null }], [{ ...balances[0], currency: { code: 'USD', precision: -1 } }]]) assert.throws(() => parseBalances(bad), { code: 'INVALID_RESPONSE' })
  for (const bad of [null, { data: null }, { data: [{}] }]) assert.throws(() => parseOperations(bad), { code: 'INVALID_RESPONSE' })
})

test('H5: settings and rates request match the reference; partial rates omit and flag GBP', async () => {
  const f = fixture(); await f.session.check()
  const view = await f.home.balanceSummary(summary)
  assert.equal(view.currency.code, 'USD'); assert.equal(view.total, 11915); assert.equal(view.available, 11665); assert.equal(view.reserved, 250)
  assert.deepEqual(view.missing, ['GBP'])
  const setting = f.state.calls.find(c => c.path === '/user/setting')
  assert.equal(setting.method, 'GET'); assert.deepEqual(Object.fromEntries(setting.query), { keys: 'PORTAL_WEB_CURRENCY_OF_TOTALS', domainName: 'client.soft-fx.com' })
  const request = f.state.calls.find(c => c.path === '/currencyrates')
  assert.equal(request.method, 'POST'); assert.equal(request.access, 'Bearer synthetic-old')
  assert.deepEqual(Object.keys(request.body).sort(), ['currencyCodesTo', 'date', 'domainName'])
  assert.equal(request.body.domainName, 'client.soft-fx.com'); assert.deepEqual(request.body.currencyCodesTo, ['USD'])
  assert.equal(new Date(request.body.date).toISOString(), request.body.date)
})
for (const mode of ['no-rates', 'rates-error']) test('H5: ' + mode + ' keeps the selected pocket at rate 1 and flags other currencies', async () => {
  const f = fixture(mode); await f.session.check()
  const view = await f.home.balanceSummary(summary)
  assert.equal(view.total, 8450); assert.equal(view.available, 8200); assert.equal(view.reserved, 250)
  assert.deepEqual(view.missing, ['EUR', 'GBP'])
})
for (const mode of ['setting-error', 'setting-unknown', 'data']) test('H5: ' + mode + ' uses domain currency without hiding data', async () => {
  const f = fixture(mode); await f.session.check()
  assert.equal((await f.home.balanceSummary(summary)).currency.code, 'USD')
})
test('H5: known setting wins over default and matching currency always has rate 1', async () => {
  const f = fixture('setting-eur'); await f.session.check()
  f.state.rates.push({ currencyFrom: 'EUR', currencyTo: 'EUR', value: 999 })
  const view = await f.home.balanceSummary(summary)
  assert.equal(view.currency.code, 'EUR'); assert.equal(view.available, 10530); assert.equal(view.reserved, 225); assert.equal(view.total, 10755)
  assert.deepEqual(view.missing, ['GBP'])
})
for (const mode of ['data']) test('H5: currency change after ' + mode + ' PUT requests fresh rates and keeps local selection', async () => {
  const f = fixture(mode); await f.session.check()
  const view = await f.home.selectCurrency(parseBalances(balances), 'EUR')
  assert.equal(view.currency.code, 'EUR'); assert.equal(view.total, 10755)
  const calls = f.state.calls.slice(1)
  assert.deepEqual(calls.map(c => [c.path, c.method]), [['/user/setting', 'PUT'], ['/currencyrates', 'POST']])
  assert.deepEqual(calls[0].body, { domainName: 'client.soft-fx.com', settings: [{ key: 'PORTAL_WEB_CURRENCY_OF_TOTALS', value: 'EUR' }] })
  assert.equal(f.state.setting, mode === 'data' ? 'EUR' : '')
  assert.ok(!f.storage.getItem(SESSION_KEY).includes('EUR'))
})
test('H5: an expired session is never swallowed as optional settings/rates/save failure', async () => {
  for (const action of ['balanceSummary', 'rates', 'selectCurrency']) {
    const f = fixture(); await f.session.check(); f.state.mode = 'expired'
    await assert.rejects(action === 'balanceSummary' ? f.home.balanceSummary(summary) : action === 'rates' ? f.home.rates('EUR') : f.home.selectCurrency(parseBalances(balances), 'EUR'), { code: 'SESSION_EXPIRED' })
  }
})
test('H5: failed save rejects and preserves the server currency across remounts', async () => {
  const f = fixture('save-error'); await f.session.check()
  await assert.rejects(f.home.selectCurrency(parseBalances(balances), 'EUR'))
  const remounted = new HomeApi(f.session, f.api)
  assert.equal((await remounted.balanceSummary(summary)).currency.code, 'USD')
  f.storage.setItem(SESSION_EPOCH_KEY, 'another-account')
  await f.session.check()
  assert.equal((await remounted.balanceSummary(summary)).currency.code, 'USD')
})
test('H5: zero net pockets are still flagged; zero funds are not; unrelated rates do not count', () => {
  const rows = parseBalances([{ ...balances[0], available: 0, reserved: 0 }, { ...balances[1], available: 10, reserved: -10 }])
  const view = balanceView(rows, usd, [{ currencyFrom: 'EUR', currencyTo: 'GBP', value: 10 }])
  assert.equal(view.total, 0); assert.deepEqual(view.missing, ['EUR'])
  assert.equal(balanceView(rows, usd, [{ currencyFrom: 'EUR', currencyTo: 'USD', value: 1.123 }]).available, 11.23)
})
test('unconfirmed account flags and absent account details fail, demo never becomes real', () => {
  const one = { accounts: [{ accountNumber: 'T', type: 'Trading' }] }
  for (const flags of [{}, { isDemo: false }, { isDemo: 'no', isArchived: false }]) assert.throws(() => realAccountNumbers(one, [{ number: 'T', type: { name: 'Trading' }, ...flags }]), { code: 'INVALID_RESPONSE' })
  assert.throws(() => realAccountNumbers(one, []), { code: 'INVALID_RESPONSE' })
  assert.throws(() => realAccountNumbers({ accounts: [{}] }, []), { code: 'INVALID_RESPONSE' })
  assert.deepEqual(realAccountNumbers(one, [{ number: 'T', type: { name: 'Trading' }, isDemo: 'True', isArchived: false }]), [])
})
test('cached summary is cleared by missing storage and can never save extra profile fields', async () => {
  const api = new CabinetApi(async () => new Response(JSON.stringify({ ...summary, secret: 'must-not-retain', profiles: [{ private: 'extra' }] })))
  const f = fixture(); const session = new Session(api, f.storage); await session.check()
  assert.equal(session.summary.secret, undefined); assert.equal(session.summary.profiles, undefined)
  f.storage.removeItem(SESSION_KEY); assert.equal(session.summary, undefined)
})
test('identity masks email and derives initials without exposing the local part', () => {
  assert.deepEqual(identity(summary), { name: 'Анна Петрова', initials: 'АП', email: 'an•••@example.invalid' })
  assert.equal(identity({ email: 'ab@example.invalid' }).initials, 'AB')
})

test('A9: display rounding, trimmed integer zeroes and zero fees', () => {
  for (const [value, precision, expected] of [[1, 8, '1'], [0.0154, 8, '0,02'], [0, 8, '0'], [1.2, 2, '1,20'], [1.234, 1, '1,23'], [123.4, 0, '123,40'], [1.23456789, 8, '1,23']]) assert.equal(money(value, {code: 'TEST', precision}), expected)
  assert.equal(feeLabel(0, usd), '—'); assert.equal(feeLabel(0, usd, true), 'Без комиссии')
  assert.equal(feeLabel(undefined, usd, true), '—'); assert.equal(feeLabel(0.0154, { code: 'BTC', precision: 8 }), '0,02 BTC')
})
test('R7: local calendar day at midnight, month/year boundary and DST', () => {
  const now = new Date(2026, 0, 1, 0, 1)
  assert.equal(dateLabel(new Date(2026, 0, 1, 0, 0).toISOString(), now), 'Сегодня, 00:00')
  assert.equal(dateLabel(new Date(2025, 11, 31, 23, 59).toISOString(), now), 'Вчера, 23:59')
  assert.equal(dateLabel(new Date(2025, 11, 30, 18, 5).toISOString(), now), '30.12.2025, 18:05')
  assert.equal(dateLabel(new Date(2026, 2, 29, 0, 1).toISOString(), new Date(2026, 2, 30, 0, 0)), 'Вчера, 00:01')
  assert.equal(dateLabel('invalid', now), '—')
})
test('BV-1: list order uses converted amounts, selected first, missing last by code; zero excluded', () => {
  const rows = [['BTC', 10], ['ZZZ', 1], ['EUR', 100], ['USD', 1], ['GBP', 1], ['JPY', 0]].map(([code, amount]) => ({ available: amount, reserved: 0, currency: {code, precision: 2} }))
  const view = balanceView(rows, usd, [{currencyFrom: 'EUR', currencyTo: 'USD', value: 1.1}])
  assert.deepEqual(balanceOptions(view).map(b => b.currency.code), ['USD', 'EUR', 'BTC', 'GBP', 'ZZZ'])
  assert.equal(excludedLabel(view.missing), 'BTC, ZZZ, GBP не учтены'); assert.equal(excludedLabel(['GBP']), 'GBP не учтён'); assert.equal(excludedLabel([]), '')
  assert.deepEqual(currencyGroups(rows).map(g => [g.name, g.balances.map(b => b.currency.code)]), [['Валюты', ['EUR', 'GBP', 'USD', 'JPY']], ['Криптовалюты', ['BTC', 'ZZZ']]])
  assert.equal(currencyName('USD'), 'Доллар США'); assert.equal(currencyName('JPY'), 'Японская иена'); assert.equal(currencyName('BTC'), 'Биткоин'); assert.equal(currencyName('ZZZ'), undefined); assert.equal(currencyName('toString'), undefined)
})


test('A9: rounding boundaries, signs, grouping and fixed main balance', () => {
  for (const [value, expected] of [[0.005, '0,01'], [78.92862243, '78,93'], [0.004, '< 0,01'], [14700, '14 700'], [-0.005, '−0,01'], [-0.004, '−< 0,01'], [-250.5, '−250,50'], [1.005, '1,01'], [0, '0'], [-0, '0']]) assert.equal(money(value, usd), expected)
  for (const [value, expected] of [[12480.5, '12 480,50'], [0, '0,00'], [14700, '14 700,00'], [0.004, '0,00']]) assert.equal(money(value, usd, true), expected)
  assert.equal(signedAmount({ amount: 0.004, positive: true, currency: usd }), '+< 0,01 USD')
  assert.equal(signedAmount({ amount: 0.004, positive: false, currency: usd }), '−< 0,01 USD')
  assert.equal(currencyName('AUD'), 'Австралийский доллар')
  assert.equal(currencyName('CAD'), 'Канадский доллар')
})
