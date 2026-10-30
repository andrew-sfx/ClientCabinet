import test from 'node:test'
import assert from 'node:assert/strict'
import { createBaseline, compareApi, extractFlow, fetchSwagger, FLOW_PATHS } from '../scripts/check-api-version.mjs'

function spec(version = 'v2.3.2.36') {
  return { openapi: '3.0.4', info: { version }, paths: Object.fromEntries(FLOW_PATHS.map(path => [path, { post: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } } } } }])), components: { schemas: { Result: { type: 'object', properties: { id: { type: 'string' }, parent: { $ref: '#/components/schemas/Result' } } } } } }
}

test('version check distinguishes last revision from any change in the first three components', () => {
  const baseline = createBaseline(spec())
  assert.equal(compareApi(baseline, spec()).kind, 'unchanged')
  assert.equal(compareApi(baseline, spec('v2.3.2.37')).kind, 'compatible-revision')
  for (const version of ['v2.3.3.0', 'v2.4.0.0', 'v3.0.0.0']) {
    const result = compareApi(baseline, spec(version))
    assert.equal(result.kind, 'version-family-change'); assert.equal(result.reviewRequired, true)
  }
})

test('same-version change to a transitive response schema requires flow review', () => {
  const baseline = createBaseline(spec()); const changed = spec()
  changed.components.schemas.Result.properties.id.type = 'number'
  const result = compareApi(baseline, changed)
  assert.equal(result.kind, 'flow-change-with-same-version')
  assert.equal(result.changes.length, 1)
  assert.match(result.changes[0].path, /Result.*id.*type/)
})

test('unrelated changes are distinguished and key order is immaterial', () => {
  const original = spec(); const baseline = createBaseline(original)
  assert.equal(compareApi(baseline, Object.fromEntries(Object.entries(original).reverse())).reviewRequired, false)
  original.paths['/unrelated'] = { get: { responses: {} } }
  const result = compareApi(baseline, original)
  assert.equal(result.kind, 'outside-flow-change'); assert.deepEqual(result.changes, [])
})

test('missing path, malformed version and unresolved or external reference fail closed', () => {
  for (const mutate of [s => { delete s.paths['/user/login'] }, s => { s.info.version = 'unknown' }, s => { delete s.components.schemas.Result }, s => { s.components.schemas.Result.properties.parent.$ref = 'https://example.invalid/schema' }]) {
    const changed = spec(); mutate(changed)
    assert.throws(() => extractFlow(changed))
  }
})

test('read-only network check neither pins a version nor writes/accepts a new baseline', async () => {
  const baseline = createBaseline(spec()); const saved = JSON.stringify(baseline)
  const latest = await fetchSwagger(async (url, init) => {
    assert.equal(url, 'https://api3.soft-fx.com/swagger/api/swagger.json')
    assert.equal(init.credentials, 'omit'); assert.equal(init.headers['X-Version'], undefined)
    return new Response(JSON.stringify(spec('v2.3.3.0')), { status: 200 })
  })
  assert.equal(compareApi(baseline, latest).reviewRequired, true)
  assert.equal(JSON.stringify(baseline), saved)
  await assert.rejects(fetchSwagger(async () => new Response('', { status: 503 })))
  await assert.rejects(fetchSwagger(async () => { throw new TypeError('offline') }))
})

test('deposit read/create operations are included in reviewed flow coverage', async () => {
 const { readFile } = await import('node:fs/promises')
 const baseline = JSON.parse(await readFile(new URL('../sources/cabinet/version-baseline.json', import.meta.url), 'utf8'))
 for (const path of ['/paymentsystem/configuration','/paymentsystem/currency','/paymentsystem/fee','/paymentsystem/amountrange','/paymentsystem/crypto/token','/paymentsystem/cryptoaddress/create','/paymentsystem/wiretransfer/bank','/paymentsystem/wiretransfer/add','/account','/user/account/balance','/user/summary','/paymentsystem/exchange/currencyrate']) {
  assert.ok(FLOW_PATHS.includes(path), path); assert.ok(baseline.flowPaths.includes(path), path); assert.ok(baseline.flow.paths[path], path)
 }
 const crypto = baseline.flow.references['#/components/schemas/portal.ps.crypto.api.model.CryptoAddressCreate']
 assert.equal(crypto.additionalProperties, false); assert.equal(crypto.properties.accountCurrencyCode, undefined)
})
