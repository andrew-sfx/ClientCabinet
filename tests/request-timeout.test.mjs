import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthError, CabinetApi, errorMessage } from '../src/auth/api.ts'
import { fixture } from './home-fixtures.ts'

test('trading details wait 60 seconds while summary and account requests keep 15 seconds', async t => {
  const deadlines = []
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    deadlines.push(milliseconds)
    return new AbortController().signal
  })
  const f = fixture()
  await f.session.check()
  const accounts = await f.home.trading(f.session.summary)
  assert.equal(accounts.length, 2)
  assert.deepEqual(deadlines, [15000, 15000, 60000])
})

for (const phase of ['headers', 'body']) test(`timeout during ${phase} is distinct from a network failure`, async t => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const expire = () => {
    controller.abort(new DOMException('Synthetic timeout', 'TimeoutError'))
    throw controller.signal.reason
  }
  const api = new CabinetApi(async () => {
    if (phase === 'headers') expire()
    return { ok: true, status: 200, text: async () => expire() }
  })
  await assert.rejects(api.request('/synthetic'), { code: 'TIMEOUT', status: 0 })
  assert.equal(errorMessage(new AuthError('TIMEOUT')), 'Время ожидания ответа сервера истекло. Попробуйте ещё раз.')
})

test('network failures and malformed JSON retain their own error codes', async () => {
  await assert.rejects(new CabinetApi(async () => { throw new TypeError('Synthetic network failure') }).request('/synthetic'), { code: 'NETWORK' })
  await assert.rejects(new CabinetApi(async () => new Response('{')).request('/synthetic'), { code: 'INVALID_RESPONSE', status: 200 })
})
