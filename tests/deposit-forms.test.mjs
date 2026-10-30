import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formsFixture,
  formConfigs,
  usd,
  usdt,
} from './deposit-forms-fixtures.ts'
import { configKey } from '../src/cabinet/deposit/model.ts'
import { DepositFormsApi } from '../src/cabinet/deposit/forms-api.ts'
import {
  amountValue,
  allowedConfigs,
  detailedConfigs,
  feeValue,
  feeDescription,
  networksFor,
  parseAddress,
  parseInvoice,
  parseTerms,
} from '../src/cabinet/deposit/forms-model.ts'
import { pdfFromJpegs } from '../src/cabinet/deposit/invoice-pdf.ts'
import { SESSION_EPOCH_KEY } from '../src/auth/session.ts'
const wireKey = configKey(formConfigs[3]),
  signal = () => new AbortController().signal
async function setup(kind = 'crypto', mode = 'data') {
  const f = formsFixture(mode)
  await f.session.check()
  const data = await f.formApi.load(kind, wireKey, signal())
  const currency = data.currencies.find(
      (c) => c.code === (kind === 'wire' ? 'USD' : 'USDT'),
    ),
    network = data.networks.find((n) => n.currency.code === currency.code),
    account = data.accounts[0],
    config = kind === 'wire' ? data.configs[0] : network.config
  return {
    ...f,
    data,
    selection: {
      revision: data.revision,
      account,
      currency,
      config,
      network: kind === 'wire' ? undefined : network,
    },
  }
}
test('crypto preserves Configuration token standards, uses one wallet identity and no fake destination currency', async () => {
  const f = await setup()
  assert.equal(f.data.accounts.length, 1)
  assert.equal(f.data.accounts[0].currency, undefined)
  assert.ok(
    f.state.calls
      .filter((c) => c.path === '/paymentsystem/configuration')
      .every(
        (c) =>
          c.query.get('isExternal') === 'true' &&
          c.query.get('isVisible') === 'true',
      ),
  )
  assert.equal(
    f.state.calls.filter((c) => c.path === '/paymentsystem/currency').length,
    0,
  )
  assert.deepEqual(
    f.data.networks
      .filter((n) => n.currency.code === 'USDT')
      .map((n) => n.token),
    ['ERC20', 'TRC20'],
  )
  assert.ok(!f.state.calls.some((c) => c.path === '/user/summary'))
  f.session.clear()
})

test('native BTC/LTC terms never call Token, retain server conditions, and wait for explicit submit', async () => {
  for (const code of ['BTC', 'LTC']) {
    const f = await setup('crypto', 'token-unavailable')
    const network = f.data.networks.find((n) => n.currency.code === code)
    assert.ok(network)
    if (code === 'LTC') assert.equal(network.config.merchantCode, 'softfx')
    const selection = {
      ...f.selection,
      currency: network.currency,
      network,
      config: network.config,
    }
    const terms = await f.formApi.terms(selection, undefined, signal())
    assert.equal(terms.min, 0.01)
    assert.ok(f.state.calls.some((c) => c.path === '/paymentsystem/fee'))
    assert.ok(
      f.state.calls.some((c) => c.path === '/paymentsystem/amountrange'),
    )
    assert.equal(
      f.state.calls.filter((c) => c.path === '/paymentsystem/crypto/token')
        .length,
      0,
    )
    assert.equal(f.state.posts, 0)
    const address = await f.formApi.createAddress(selection, signal())
    assert.ok(address.value)
    assert.equal(f.state.posts, 1)
    const body = f.state.calls.find((c) => c.method === 'POST').body
    assert.equal(body.reuse, true)
    assert.ok(!('accountCurrencyCode' in body))
    assert.ok(!('merchantCode' in body))
    f.session.clear()
  }
})

test('crypto grade permission includes merchant identity, restores merchant-specific Litecoin only on exact match', () => {
  const ltc = formConfigs[4]
  assert.equal(
    allowedConfigs(detailedConfigs([ltc]), detailedConfigs([ltc])).length,
    1,
  )
  assert.equal(
    allowedConfigs(
      detailedConfigs([ltc]),
      detailedConfigs([{ ...ltc, merchantCode: '' }]),
    ).length,
    0,
  )
})

test('Ethereum native and USDT Token refusals still stop terms without creating requests', async () => {
  for (const code of ['ETH', 'USDT']) {
    const f = await setup('crypto', 'token-unavailable')
    const network = f.data.networks.find((n) => n.currency.code === code)
    const selection = {
      ...f.selection,
      currency: network.currency,
      network,
      config: network.config,
    }
    await assert.rejects(f.formApi.terms(selection, undefined, signal()), {
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      status: 400,
    })
    assert.equal(
      f.state.calls.filter((c) => c.path === '/paymentsystem/crypto/token')
        .length,
      1,
    )
    assert.equal(f.state.posts, 0)
    f.session.clear()
  }
})
test('wire loads currencies and normalizes enabled real trading flags; profile only contributes country', async () => {
  const f = await setup('wire')
  assert.deepEqual(
    f.data.currencies.map((c) => c.code),
    ['USD', 'EUR'],
  )
  assert.ok(
    f.data.accounts.some((a) => !a.wallet && a.number === 'TEST-TRADING'),
  )
  assert.deepEqual(f.data.country, { code: 'US', name: 'United States' })
  assert.ok(!JSON.stringify(f.data).includes('profiles'))
  f.session.clear()
})
test('terms use distinct Fee and AmountRange parameter names; selected standard is validated; fee percent is multiplier', async () => {
  const f = await setup()
  const terms = await f.formApi.terms(f.selection, undefined, signal())
  assert.equal(terms.available, 5)
  assert.equal(feeValue(1000, terms.fee), 2)
  const fee = f.state.calls.find((c) => c.path === '/paymentsystem/fee'),
    range = f.state.calls.find((c) => c.path === '/paymentsystem/amountrange'),
    token = f.state.calls.find((c) => c.path === '/paymentsystem/crypto/token')
  assert.equal(fee.query.get('paymentTypeCode'), 'Ethereum')
  assert.equal(range.query.get('paymentType'), 'Ethereum')
  assert.equal(range.query.get('balanceOperationType'), 'Credit')
  assert.equal(range.query.get('paymentTypeCode'), null)
  assert.equal(token.query.get('cryptoTokenStandardCode'), 'ERC20')
  assert.equal(token.query.get('financeOperationTypeName'), null)
  assert.equal(token.query.get('countryCode'), null)
  assert.equal(token.query.get('merchantCode'), '')
  f.session.clear()
})
test('currency changes build disjoint network sets; wrong asset/tuple cannot create address', async () => {
  const configs = detailedConfigs(formConfigs),
    nets = networksFor(configs)
  assert.ok(
    nets.filter((n) => n.currency.code === 'BTC').every((n) => !n.token),
  )
  const f = await setup()
  await assert.rejects(
    f.formApi.createAddress({ ...f.selection, currency: usd }, signal()),
    { code: 'ACCOUNT_UNAVAILABLE' },
  )
  assert.equal(f.state.posts, 0)
  f.session.clear()
})
test('amount validates precision, bounds, and decimal round-trip without silently rounding precision20', () => {
  const terms = { min: 0.01, max: 100000 }
  assert.equal(amountValue('1 000,25', usd, terms), 1000.25)
  for (const [value, code] of [
    ['', 'AMOUNT_REQUIRED'],
    ['0.001', 'AMOUNT_PRECISION'],
    ['0', 'AMOUNT_REQUIRED'],
    ['100001', 'AMOUNT_MAX'],
  ])
    assert.throws(() => amountValue(value, usd, terms), { code })
  const high = { ...usdt, precision: 20 }
  assert.throws(() => amountValue('0.10000000000000000001', high, terms), {
    code: 'AMOUNT_PRECISION',
  })
  assert.equal(amountValue('0.10000000000000000000', high, terms), 0.1)
  assert.throws(
    () => parseTerms([], { min: 2, max: 1 }, usd, [], { wallet: true }),
    { code: 'INVALID_RESPONSE' },
  )
})
test('crypto submit sends only reviewed target DTO, no accountCurrencyCode; optional tag is parsed', async () => {
  const f = await setup()
  const result = await f.formApi.createAddress(f.selection, signal())
  assert.ok(result.value.startsWith('[Адрес'))
  assert.ok(result.tag.startsWith('[Тег'))
  const post = f.state.calls.find((c) => c.method === 'POST')
  assert.deepEqual(
    Object.keys(post.body).sort(),
    [
      'accountNumber',
      'currencyCode',
      'cryptoTokenStandardCode',
      'domainName',
      'paymentTypeCode',
      'paymentOptionCode',
      'paymentRouteCode',
      'reuse',
    ].sort(),
  )
  assert.equal(post.body.reuse, true)
  assert.ok(!Object.hasOwn(post.body, 'accountCurrencyCode'))
  assert.equal(f.markers.size, 0)
  f.session.clear()
})
test('wire duplicate submit is locked before bank GET; chooses first bank and preserves dynamic invoice', async () => {
  const f = await setup('wire')
  f.state.delay = 5
  const pending = f.formApi.createInvoice(
    f.selection,
    1000,
    f.data.country,
    signal(),
  )
  await assert.rejects(
    f.formApi.createInvoice(f.selection, 1000, f.data.country, signal()),
    { code: 'SUBMIT_IN_PROGRESS' },
  )
  const invoice = await pending
  assert.equal(
    f.state.calls.filter((c) => c.path === '/paymentsystem/wiretransfer/bank')
      .length,
    1,
  )
  assert.equal(f.state.posts, 1)
  assert.ok(invoice.groups[1][0].value.includes('не для перевода'))
  assert.equal(
    f.state.calls.find((c) => c.method === 'POST').body.paymentDetails
      .bankCountry,
    'United States',
  )
  f.session.clear()
})
for (const mode of ['post-network', 'post-500', 'post-invalid', 'post-401'])
  test(
    'uncertain ' +
      mode +
      ' sends once, persists an opaque marker, rejects remount retry',
    async () => {
      const f = await setup('crypto', mode)
      await assert.rejects(f.formApi.createAddress(f.selection, signal()), {
        code: 'OPERATION_UNKNOWN',
      })
      assert.equal(f.state.posts, 1)
      assert.equal(
        await f.formApi.hasUnknown('crypto', f.selection.account.number),
        true,
      )
      const remounted = new DepositFormsApi(
        f.session,
        f.formFetcher,
        f.markerStorage,
      )
      await assert.rejects(remounted.createAddress(f.selection, signal()), {
        code: 'OPERATION_UNKNOWN',
      })
      assert.equal(f.state.posts, 1)
      assert.ok([...f.markers.keys()].every((k) => !k.includes('TEST')))
      assert.ok([...f.markers.values()].every((v) => v === 'pending'))
      f.session.clear()
    },
  )
test('known 400 rejection allows a fresh explicit submit, never automatic retry', async () => {
  const f = await setup('crypto', 'post-400')
  await assert.rejects(f.formApi.createAddress(f.selection, signal()), {
    status: 400,
  })
  assert.equal(f.state.posts, 1)
  assert.equal(f.markers.size, 0)
  f.state.mode = 'data'
  await f.formApi.createAddress(f.selection, signal())
  assert.equal(f.state.posts, 2)
  f.session.clear()
})
for (const mode of ['no-country', 'no-banks'])
  test(mode + ' blocks before any creating request', async () => {
    const f = await setup('wire', mode)
    await assert.rejects(
      f.formApi.createInvoice(f.selection, 1000, f.data.country, signal()),
      {
        code: mode === 'no-country' ? 'COUNTRY_REQUIRED' : 'NO_BANKS_AVAILABLE',
      },
    )
    assert.equal(f.state.posts, 0)
    assert.equal(f.markers.size, 0)
    f.session.clear()
  })
test('terms errors do not manufacture zero fee or permission', async () => {
  const f = await setup('crypto', 'terms-error')
  await assert.rejects(f.formApi.terms(f.selection, undefined, signal()), {
    status: 503,
  })
  assert.equal(f.state.posts, 0)
  f.session.clear()
})
test('late logout and account switch reject complete multi-stage operations and stale selection before POST', async () => {
  const f = formsFixture()
  await f.session.check()
  f.state.delay = 15
  const pending = f.formApi.load('crypto', wireKey, signal())
  f.session.clear()
  await assert.rejects(pending, { code: 'SESSION_EXPIRED' })
  const g = await setup()
  g.storage.setItem(SESSION_EPOCH_KEY, 'synthetic-another-account')
  await assert.rejects(g.formApi.createAddress(g.selection, signal()), {
    code: 'SESSION_EXPIRED',
  })
  assert.equal(g.state.posts, 0)
  g.session.clear()
})
test('malformed creation success is never displayed as an invented result', () => {
  assert.throws(() => parseAddress({ value: null }), {
    code: 'INVALID_RESPONSE',
  })
  assert.throws(() => parseInvoice({ invoice: { amount: '1000', body: {} } }), {
    code: 'INVALID_RESPONSE',
  })
})
test('PDF retains binary streams and valid cross-reference offsets for all Unicode-rendered pages', () => {
  const data = pdfFromJpegs([
      {
        bytes: Uint8Array.from([255, 216, 255, 217]),
        width: 1240,
        height: 1754,
      },
      {
        bytes: Uint8Array.from([255, 216, 255, 217]),
        width: 1240,
        height: 1754,
      },
    ]),
    content = new TextDecoder('latin1').decode(data)
  assert.ok(content.startsWith('%PDF-1.4'))
  assert.ok(content.includes('/Count 2'))
  const start = Number(content.match(/startxref\n(\d+)/)[1])
  assert.equal(new TextDecoder().decode(data.slice(start, start + 4)), 'xref')
  const offsets = content
    .match(/\d{10} 00000 n/g)
    .map((s) => Number(s.slice(0, 10)))
  for (const offset of offsets)
    assert.match(
      new TextDecoder().decode(data.slice(offset, offset + 12)),
      /^\d+ 0 obj/,
    )
})

test('token refusal is preserved, without diagnostic fallback or creating requests', async () => {
  const f = await setup('crypto', 'token-unavailable')
  await assert.rejects(f.formApi.terms(f.selection, undefined, signal()), {
    code: 'PAYMENT_METHOD_UNAVAILABLE',
    status: 400,
  })
  assert.equal(
    f.state.calls.filter((c) => c.path === '/paymentsystem/crypto/token')
      .length,
    1,
  )
  assert.equal(f.state.posts, 0)
  f.session.clear()
})
test('network labels preserve token codes and fee descriptions retain minimum conditions', () => {
  assert.deepEqual(
    networksFor(detailedConfigs(formConfigs))
      .filter((n) => n.currency.code === 'USDT')
      .map((n) => n.label),
    ['ERC20', 'TRC20'],
  )
  const fee = { currency: usd, percent: 0, constant: 0, min: 5 }
  assert.equal(feeDescription(fee), 'не менее 5 USD')
  assert.equal(feeDescription(fee, 100), '5 USD')
  assert.equal(feeDescription({ ...fee, min: 0 }), 'Без комиссии')
  const terms = parseTerms(
    [{ currency: usd, percent: 0.002, constant: 0, minValue: 0, maxValue: 0 }],
    { min: 0.01, max: 100000 },
    usd,
    [{ currency: usd, available: 0 }],
    { number: 'TEST', wallet: true, currency: usd },
  )
  assert.equal(feeValue(1000, terms.fee), 2)
})
