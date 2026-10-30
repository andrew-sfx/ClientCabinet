import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { CabinetApi } from '../src/auth/api.ts'
import { Registration } from '../src/auth/registration.ts'
import { Session, SESSION_KEY } from '../src/auth/session.ts'

// Credentials and token placeholders are generated in memory, never recorded.
const secret = () => randomBytes(24).toString('base64url')
const input = () => ({ country: 'GB', email: 'cc-reg-test-synthetic@example.com', password: 'Aa7' + secret(), corporate: false })
function fixture({ fail, code = 'ACCESS_DENIED', status = 400, network = false, pause, falseType = false, storageFail = false, once = false, malformed = false } = {}) {
  const seen = [], values = new Map()
  const store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (storageFail && k === SESSION_KEY) throw Error(); values.set(k, v) }, removeItem: k => values.delete(k) }
  const token = { access_token: secret(), refresh_token: secret(), token_type: 'Bearer', expires_in: 3600 }
  const api = new CabinetApi(async (url, init) => {
    const path = new URL(url).pathname
    seen.push({ path, body: init.body ? JSON.parse(init.body) : undefined })
    if (path === pause?.path) await pause.promise
    if (path === fail) {
      if (once) fail = undefined
      if (network) throw Error()
      return new Response(JSON.stringify({ error: { innerErrors: [{ code }] } }), { status })
    }
    const body = path === '/profile/country' ? [{ code: 'GB', name: 'UNITED KINGDOM' }]
      : path === '/verification/user/type' ? [{ name: 'Personal', isEditable: false }, { name: 'Corporate', isEditable: false }]
      : path === '/user/registration' ? { token: malformed ? { ...token, refresh_token: undefined } : token }
      : path === '/verification/user/type/update' ? !falseType
      : path === '/user/account/summary' ? { id: 'synthetic' } : null
    return new Response(JSON.stringify(body))
  })
  const session = new Session(api, store)
  const flow = new Registration(api, operation => session.register(operation))
  return { flow, seen, session, store, values }
}
const starts = f => f.seen.filter(x => x.path === '/user/registration').length
test('R3 local validation and unsupported corporate submission send no mutation', async () => {
  const f = fixture(); await f.flow.configuration()
  await f.flow.submit({ ...input(), email: 'bad', country: '', password: '' })
  assert.equal(f.flow.state, 'r3'); assert.equal(starts(f), 0)
  await f.flow.submit({ ...input(), corporate: true }); assert.equal(starts(f), 0)
})
test('R9b requires every step, subscription false and protected session verification', async () => {
  const f = fixture(); await f.flow.configuration(); await f.flow.submit(input())
  assert.equal(f.flow.state, 'r9b'); assert.ok(f.store.getItem(SESSION_KEY))
  assert.deepEqual(f.seen.slice(2).map(x => x.path), ['/user/registration', '/identity/update', '/verification/user/type/update', '/profile/type/personal', '/profile/contact', '/user/account/summary'])
  assert.equal(f.seen.find(x => x.path === '/profile/contact').body.isSubscribeToNotification, false)
  await f.flow.submit(input()); assert.equal(starts(f), 1)
})
for (const code of ['LOGIN_IN_USE', 'PASSWORD_LENGTH_INVALID']) test(`${code} keeps the same provisional user for correction`, async () => {
  const f = fixture({ fail: '/identity/update', code, once: true }); await f.flow.configuration()
  await f.flow.submit(input()); assert.equal(f.flow.state, code === 'LOGIN_IN_USE' ? 'r5' : 'r3')
  assert.equal(f.session.hasSession, false)
  await f.flow.submit(input()); assert.equal(starts(f), 1); assert.equal(f.flow.state, 'r9b')
  assert.equal(f.session.hasSession, true)
})
for (const network of [true, false]) test(`R6 ${network ? 'network' : '5xx'} allows explicit retry before known creation`, async () => {
  const f = fixture({ fail: '/user/registration', network, status: 503 }); await f.flow.configuration()
  await f.flow.submit(input()); assert.equal(f.flow.state, 'r6'); assert.equal(f.session.hasSession, false)
  await f.flow.submit(input()); assert.equal(starts(f), 2)
})
for (const fail of ['/identity/update', '/verification/user/type/update', '/profile/type/personal', '/profile/contact', '/user/account/summary']) test(`R7 on ${fail} never persists or registers twice`, async () => {
  const f = fixture({ fail }); await f.flow.configuration(); await f.flow.submit(input())
  assert.equal(f.flow.state, 'r7'); assert.equal(f.session.hasSession, false)
  await f.flow.submit(input()); assert.equal(starts(f), 1)
  assert.ok(f.seen.some(x => x.path === '/token/revoke'))
  if (fail !== '/identity/update') for (const path of ['/verification/user/type/update', '/profile/type/personal', '/profile/contact']) assert.ok(f.seen.some(x => x.path === path))
})
test('HTTP 200 false user type is a rejected profile step', async () => {
  const f = fixture({ falseType: true }); await f.flow.configuration(); await f.flow.submit(input())
  assert.equal(f.flow.state, 'r7'); assert.equal(f.session.hasSession, false)
})
test('R4 blocks duplicate submission; no temporary token enters storage', async () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  const f = fixture({ pause: { path: '/identity/update', promise } }); await f.flow.configuration()
  const pending = f.flow.submit(input()); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.flow.state, 'r4'); assert.equal(f.store.getItem(SESSION_KEY), null)
  await f.flow.submit(input()); assert.equal(starts(f), 1)
  release(); await pending; assert.equal(f.flow.state, 'r9b')
})
test('logout during registration prevents late session adoption', async () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  const f = fixture({ pause: { path: '/identity/update', promise } }); await f.flow.configuration()
  const pending = f.flow.submit(input()); await new Promise(resolve => setImmediate(resolve))
  await f.session.logout(); release(); await pending
  assert.equal(f.flow.state, 'r7'); assert.equal(f.session.hasSession, false)
})
test('storage failure is R7, revokes provisional session', async () => {
  const f = fixture({ storageFail: true }); await f.flow.configuration(); await f.flow.submit(input())
  assert.equal(f.flow.state, 'r7'); assert.equal(f.session.hasSession, false)
})
test('country loading failure supplies no fallback list', async () => {
  const f = fixture({ fail: '/profile/country', network: true })
  await assert.rejects(f.flow.configuration()); assert.deepEqual(f.flow.countries, [])
  await f.flow.submit(input()); assert.equal(starts(f), 0)
})
test('malformed successful creation is R7, never another start, and revokes available access', async () => {
  const f = fixture({ malformed: true }); await f.flow.configuration(); await f.flow.submit(input())
  assert.equal(f.flow.state, 'r7'); await f.flow.submit(input()); assert.equal(starts(f), 1)
  assert.equal(f.session.hasSession, false); assert.ok(f.seen.some(x => x.path === '/token/revoke'))
})
test('leaving R5 revokes the provisional token, then permanently prevents submit', async () => {
  const f = fixture({ fail: '/identity/update', code: 'LOGIN_IN_USE' }); await f.flow.configuration(); await f.flow.submit(input())
  await f.flow.dispose(); assert.equal(f.seen.at(-1).path, '/token/revoke')
  await f.flow.submit(input()); assert.equal(starts(f), 1)
})
test('unmount while start is pending revokes its late token without Identity update', async () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  const f = fixture({ pause: { path: '/user/registration', promise } }); await f.flow.configuration()
  const pending = f.flow.submit(input()); await new Promise(resolve => setImmediate(resolve))
  await f.flow.dispose(); release(); await pending
  assert.equal(f.flow.state, 'r7'); assert.equal(f.session.hasSession, false)
  assert.equal(f.seen.some(x => x.path === '/identity/update'), false)
  assert.equal(f.seen.at(-1).path, '/token/revoke')
})
