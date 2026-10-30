import test from 'node:test'
import assert from 'node:assert/strict'
import { CabinetApi, AuthError, errorMessage } from '../src/auth/api.ts'
import { authConfig } from '../src/auth/config.ts'
import { Session, SESSION_KEY } from '../src/auth/session.ts'

const tokens = { access: 'test-access', refresh: 'test-refresh', expiresAt: 3600000 }
const ticket = { tokens: [
  { grant_type: 'access_token', value: tokens.access, expires_in: 3600, token_type: 'Bearer' },
  { grant_type: 'refresh_token', value: tokens.refresh },
] }
const mfa = { error: { innerErrors: [{ code: 'MULTI_FACTOR_REQUIRED', details: { state: 'test-state' } }] } }
const factor = { identityFactors: [{ code: 'FIRST_FACTOR', identityTypes: [{ name: 'Password', isEnabled: true }] }] }
function storage(initial) {
  const values = new Map(initial ? [[SESSION_KEY, JSON.stringify(initial)]] : [])
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
function apiStub(overrides = {}) {
  return { login: async () => tokens, verify: async () => {}, refresh: async () => ({ ...tokens, access: 'renewed' }), revoke: async () => {}, ...overrides }
}
function sequence(items, seen = []) {
  return async function (url, init) {
    assert.equal(this, undefined, 'Native fetch must not receive the adapter as this')
    const item = items.shift()
    assert.ok(item, 'Unexpected extra request')
    assert.ok(url.startsWith(authConfig.apiUrl))
    assert.equal(init.credentials, 'omit')
    seen.push({ path: new URL(url).pathname, init })
    if (item instanceof Error) throw item
    return new Response(JSON.stringify(item.body), { status: item.status ?? 200 })
  }
}

for (const identifier of ['test@example.invalid', '+12025550123']) test(`real contract preserves identifier ${identifier} through Password verification`, async () => {
  const seen = []
  const api = new CabinetApi(sequence([
    { body: [{ identityTypeName: 'Password', isExternal: false }] }, { status: 400, body: mfa },
    { body: factor }, { body: { state: 'verified-state' } }, { body: ticket }, { body: { id: 'synthetic-id' } },
  ], seen), () => 0)
  const store = storage()
  await new Session(api, store, () => 0).login(identifier, 'synthetic-password')
  assert.equal(JSON.parse(seen[1].init.body).identifier, identifier)
  assert.equal(JSON.parse(seen[3].init.body).key, identifier)
  assert.equal(JSON.parse(seen[4].init.body).identifier, identifier)
  assert.deepEqual(seen.map(x => x.path), ['/user/login/configuration', '/user/login', '/identity/configuration', '/identity/verify', '/user/login', '/user/account/summary'])
  assert.equal(JSON.parse(seen[3].init.body).code, 'synthetic-password')
  assert.equal(JSON.parse(seen[4].init.body).state, 'verified-state')
  assert.equal(seen[5].init.headers.get('Authorization'), 'Bearer test-access')
  assert.equal(JSON.parse(store.getItem(SESSION_KEY)).access, tokens.access)
})

test('unsupported additional factor stops flow without fabricating a session', async () => {
  const api = new CabinetApi(sequence([
    { body: [{ identityTypeName: 'Password', isExternal: false }] }, { status: 400, body: mfa },
    { body: factor }, { body: { state: 'verified-state' } }, { status: 400, body: mfa },
    { body: { identityFactors: [{ code: 'SECOND_FACTOR', identityTypes: [{ name: 'ExternalDevice', isEnabled: true }] }] } },
  ]))
  await assert.rejects(api.login('test@example.invalid', 'synthetic-password'), { code: 'ADDITIONAL_FACTOR' })
})

test('unsupported password configuration fails closed', async () => {
  const api = new CabinetApi(sequence([{ body: [{ identityTypeName: 'ExternalDevice', isExternal: true }] }]))
  await assert.rejects(api.login('test@example.invalid', 'synthetic-password'), { code: 'PASSWORD_DISABLED' })
})

test('network, invalid credentials, throttling and service errors are safe messages', async () => {
  for (const [item, code] of [[new TypeError('network'), 'NETWORK'], [{status: 400, body: {error: {innerErrors: [{code: 'VERIFICATION_CODE_INVALID', message: 'do not expose'}]}}}, 'VERIFICATION_CODE_INVALID'], [{status: 429, body: {}}, 'RATE_LIMIT'], [{status: 503, body: {}}, 'UNAVAILABLE']]) {
    const api = new CabinetApi(sequence([item]))
    await assert.rejects(api.configuration(), error => error.code === code && !errorMessage(error).includes('do not expose'))
  }
})

test('token alone does not establish a session; failed verification revokes candidate', async () => {
  const store = storage(); let revoked = false
  const session = new Session(apiStub({ verify: async () => { throw new AuthError('REQUEST_FAILED', 401) }, revoke: async () => { revoked = true } }), store)
  await assert.rejects(session.login('test@example.invalid', 'synthetic-password'))
  assert.equal(store.getItem(SESSION_KEY), null); assert.equal(session.hasSession, false); assert.ok(revoked)
})

test('page reload revalidates stored session with protected request', async () => {
  let checks = 0
  const session = new Session(apiStub({ verify: async () => { checks++ } }), storage(tokens), () => 0)
  assert.equal(await session.check(), true); assert.equal(checks, 1)
})

test('expiry proactively refreshes once for simultaneous callers and persists rotated token', async () => {
  let refreshes = 0; const seen = []; const store = storage({ ...tokens, expiresAt: 1000 })
  const session = new Session(apiStub({ refresh: async () => { refreshes++; return { ...tokens, access: 'renewed' } }, verify: async access => seen.push(access) }), store, () => 0)
  assert.deepEqual(await Promise.all([session.check(), session.check()]), [true, true])
  assert.equal(refreshes, 1); assert.deepEqual(seen, ['renewed']); assert.equal(JSON.parse(store.getItem(SESSION_KEY)).access, 'renewed')
})

test('401 refreshes and retries protected request only once', async () => {
  let checks = 0; let refreshes = 0
  const session = new Session(apiStub({ verify: async () => { checks++; throw new AuthError('REQUEST_FAILED', 401) }, refresh: async () => { refreshes++; return tokens } }), storage(tokens), () => 0)
  await assert.rejects(session.check(), {code: 'SESSION_EXPIRED'})
  assert.equal(checks, 2); assert.equal(refreshes, 1); assert.equal(session.hasSession, false)
})

test('rejected refresh clears session; transport failure retains retryable credentials but grants no screen', async () => {
  for (const status of [400, 401, 403, 0]) {
    const session = new Session(apiStub({ refresh: async () => { throw new AuthError(status ? 'REJECTED' : 'NETWORK', status) } }), storage({...tokens, expiresAt: 1}), () => 0)
    await assert.rejects(session.check())
    assert.equal(session.hasSession, status === 0)
  }
})

test('logout clears storage even when server revoke fails; reload cannot reopen', async () => {
  const store = storage(tokens)
  const session = new Session(apiStub({ revoke: async () => { throw new AuthError('NETWORK') } }), store)
  assert.equal(await session.logout(), false); assert.equal(session.hasSession, false)
  assert.equal(await new Session(apiStub(), store).check(), false)
})

test('logout during refresh cannot resurrect session and revokes late credentials', async () => {
  let release; const revoked = []
  const session = new Session(apiStub({ refresh: () => new Promise(resolve => { release = resolve }), revoke: async access => { revoked.push(access) } }), storage({...tokens, expiresAt: 1}), () => 0)
  const checking = assert.rejects(session.check(), {code: 'SESSION_EXPIRED'})
  const loggingOut = session.logout()
  release({...tokens, access: 'late-access'})
  await checking; await loggingOut
  assert.equal(session.hasSession, false); assert.ok(revoked.includes('late-access'))
})

test('logout during protected verification cannot reopen screen', async () => {
  let release
  const session = new Session(apiStub({ verify: () => new Promise(resolve => { release = resolve }) }), storage(tokens), () => 0)
  const checking = assert.rejects(session.check(), {code:'SESSION_EXPIRED'})
  await session.logout(); release(); await checking
  assert.equal(session.hasSession, false)
})

test('malformed storage and blocked storage fail safely', async () => {
  const broken = storage(); broken.getItem = () => '{'
  assert.equal(await new Session(apiStub(), broken).check(), false)
  const blocked = storage(); blocked.setItem = () => { throw new Error('blocked') }
  const session = new Session(apiStub(), blocked)
  await assert.rejects(session.login('test@example.invalid', 'synthetic-password'), {code:'STORAGE_UNAVAILABLE'})
  assert.equal(session.hasSession, false)
})

test('refresh uses encoded form and rejects incomplete response', async () => {
  const seen = []
  const api = new CabinetApi(sequence([{body:{ access_token: 'new', refresh_token: 'new-refresh', expires_in: 300, token_type: 'bearer' }}, {body:{}}], seen), () => 0)
  assert.equal((await api.refresh('synthetic+a&b')).access, 'new')
  assert.equal(new URLSearchParams(seen[0].init.body).get('refresh_token'), 'synthetic+a&b')
  await assert.rejects(api.refresh('synthetic'), {code:'INVALID_RESPONSE'})
})

test('failed revoke of a late refresh is reported even if the old token revoke succeeds', async () => {
  let release
  const session = new Session(apiStub({ refresh: () => new Promise(resolve => { release = resolve }), revoke: async access => { if (access === 'late-access') throw new AuthError('NETWORK') } }), storage({...tokens, expiresAt: 1}), () => 0)
  const checking = assert.rejects(session.check(), {code:'SESSION_EXPIRED'})
  const logout = session.logout()
  release({...tokens, access:'late-access'})
  await checking
  assert.equal(await logout, false)
  assert.equal(session.hasSession, false)
})

function mutex() {
  let tail = Promise.resolve()
  return operation => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
}

test('two tabs share one rotating refresh and both verify the new token', async () => {
  const shared = storage({...tokens, expiresAt: 1000}); const lock = mutex()
  let refreshes = 0; const verified = []
  const api = apiStub({ refresh: async () => { refreshes++; return {...tokens, access:'shared-new'} }, verify: async access => { verified.push(access) } })
  const first = new Session(api, shared, () => 0, lock)
  const second = new Session(api, shared, () => 0, lock)
  assert.deepEqual(await Promise.all([first.check(), second.check()]), [true,true])
  assert.equal(refreshes, 1); assert.deepEqual(verified, ['shared-new','shared-new'])
})

test('simultaneous 401 in two tabs produces one refresh and one retry per tab', async () => {
  const shared = storage(tokens); const lock = mutex(); let refreshes = 0; let failed = 0; let success = 0
  const api = apiStub({ refresh: async () => { refreshes++; return {...tokens,access:'new'} }, verify: async access => { if(access===tokens.access) { failed++; throw new AuthError('REQUEST_FAILED',401) } success++ } })
  const first = new Session(api,shared,()=>0,lock); const second = new Session(api,shared,()=>0,lock)
  assert.deepEqual(await Promise.all([first.check(),second.check()]),[true,true])
  assert.equal(refreshes,1); assert.equal(failed,2); assert.equal(success,2)
})

test('a sleeping tab reads the shared rotated tokens instead of its old in-memory copy', async () => {
  const shared = storage({...tokens,expiresAt:1}); const lock = mutex(); let refreshes = 0
  const api = apiStub({refresh:async()=>{refreshes++;return {...tokens,access:'new'}}})
  const first = new Session(api,shared,()=>0,lock); const second = new Session(api,shared,()=>0,lock)
  await first.check(); await second.check()
  assert.equal(refreshes,1); assert.equal(second.expiresAt,tokens.expiresAt)
})

test('logout in one tab clears other tabs without a second revoke, including a fresh page', async () => {
  const shared = storage(tokens); const lock = mutex(); let revokes = 0
  const api = apiStub({revoke:async()=>{revokes++}})
  const first = new Session(api,shared,()=>0,lock); const second = new Session(api,shared,()=>0,lock)
  assert.equal(await first.logout(),true)
  assert.equal(second.hasSession,false); assert.equal(await second.check(),false)
  assert.equal(await new Session(api,shared,()=>0,lock).check(),false)
  assert.equal(revokes,1)
})

test('logout in another tab invalidates refresh even without receiving a storage event', async () => {
  const shared = storage({...tokens,expiresAt:1}); const lock = mutex(); const revoked=[]
  let release, started
  const ready = new Promise(resolve=>{started=resolve})
  const api = apiStub({refresh:()=>new Promise(resolve=>{release=resolve;started()}),revoke:async access=>{revoked.push(access)}})
  const first = new Session(api,shared,()=>0,lock); const second = new Session(api,shared,()=>0,lock)
  const check = assert.rejects(first.check(),{code:'SESSION_EXPIRED'})
  await ready
  const logout=second.logout()
  release({...tokens,access:'late'})
  await check;await logout
  assert.equal(first.hasSession,false);assert.equal(second.hasSession,false)
  assert.equal(shared.getItem(SESSION_KEY),null);assert.ok(revoked.includes('late'))
})

test('logout in another tab also invalidates a pending login with no stored tokens yet', async () => {
  const shared = storage(); const lock=mutex();let release
  const first=new Session(apiStub({login:()=>new Promise(resolve=>{release=resolve})}),shared,()=>0,lock)
  const second=new Session(apiStub(),shared,()=>0,lock)
  const login=assert.rejects(first.login('test@example.invalid','synthetic-password'),{code:'SESSION_EXPIRED'})
  await Promise.resolve()
  await second.logout();release(tokens);await login
  assert.equal(shared.getItem(SESSION_KEY),null)
})

test('a late 401 for the old session cannot clear a newly logged-in session', async () => {
  const shared=storage(tokens);const lock=mutex();let reject
  const first=new Session(apiStub({verify:()=>new Promise((_,r)=>{reject=r})}),shared,()=>0,lock)
  const second=new Session(apiStub({login:async()=>({...tokens,access:'other-login'})}),shared,()=>0,lock)
  const checking=assert.rejects(first.check(),{code:'SESSION_EXPIRED'})
  await second.login('test@example.invalid','synthetic-password')
  reject(new AuthError('REQUEST_FAILED',401));await checking
  assert.equal(JSON.parse(shared.getItem(SESSION_KEY)).access,'other-login')
})

test('refresh starts at the 60-second boundary, not earlier', async () => {
  let now=0,refreshes=0
  const shared=storage({...tokens,expiresAt:60001})
  const session=new Session(apiStub({refresh:async()=>{refreshes++;return tokens}}),shared,()=>now)
  await session.check();assert.equal(refreshes,0)
  now=1;await session.check();assert.equal(refreshes,1)
})

test('new session check is not tied to an in-flight check for the previous login', async () => {
  const shared=storage(tokens);const lock=mutex();let finish
  const first=new Session(apiStub({verify:async access=>{if(access===tokens.access) await new Promise(resolve=>{finish=resolve})}}),shared,()=>0,lock)
  const second=new Session(apiStub({login:async()=>({...tokens,access:'new-login'})}),shared,()=>0,lock)
  const old=assert.rejects(first.check(),{code:'SESSION_EXPIRED'})
  await second.login('test@example.invalid','synthetic-password')
  assert.equal(await first.check(),true)
  finish();await old
})

const codeFactor = { state: 'code-state', identityFactors: [{ code: 'SECOND_FACTOR', identityTypes: [
  { name: 'Sms', isEnabled: true }, { name: 'Email', isEnabled: true }, { name: 'GoogleAuthenticator', isEnabled: true },
  { name: 'Unknown', isEnabled: true }, { name: 'Disabled', isEnabled: false },
] }] }
const codeDelivery = { length: 6, expiresIn: 120, resendIn: 30, maskedContact: '***12' }
const passwordSequence = () => [
  { body: [{ identityTypeName: 'Password', isExternal: false }] }, { status: 400, body: mfa },
  { body: factor }, { body: { state: 'password-verified' } }, { status: 400, body: mfa }, { body: codeFactor },
]

test('token issuance before password verification is rejected and revoked even if cleanup fails', async () => {
  for (const cleanup of [{ body: null }, new TypeError('offline')]) {
    const seen = []; const store = storage()
    const api = new CabinetApi(sequence([{ body: [{ identityTypeName: 'Password', isExternal: false }] }, { body: ticket }, cleanup], seen))
    await assert.rejects(new Session(api, store).login('test@example.invalid', 'synthetic'), { code: 'PASSWORD_NOT_VERIFIED' })
    assert.equal(store.getItem(SESSION_KEY), null)
    assert.deepEqual(seen.map(x => x.path), ['/user/login/configuration', '/user/login', '/token/revoke'])
  }
})

test('MFA sends configured code, verifies rotated state, then establishes protected session', async () => {
  const seen = []; const store = storage()
  const api = new CabinetApi(sequence([...passwordSequence(), { body: codeDelivery }, { body: { state: 'code-verified' } }, { body: ticket }, { body: { id: 'synthetic' } }], seen))
  const session = new Session(api, store)
  await assert.rejects(session.login('test@example.invalid', 'synthetic'), error => {
    assert.deepEqual(error.challenge.types, ['Sms', 'Email', 'GoogleAuthenticator']); return error.code === 'FACTOR_REQUIRED'
  })
  assert.equal(store.getItem(SESSION_KEY), null)
  const sent = await session.sendCode('Sms')
  assert.equal(sent.length, 6); assert.equal(sent.maskedContact, '***12')
  await session.verifyCode('Sms', '123456')
  assert.equal(session.hasSession, true)
  assert.deepEqual(JSON.parse(seen[6].init.body), { domainName: 'client.soft-fx.com', state: 'code-state', identityTypeName: 'Sms' })
  assert.deepEqual(JSON.parse(seen[7].init.body), { domainName: 'client.soft-fx.com', state: 'code-state', identityFactorCode: 'SECOND_FACTOR', identityTypeName: 'Sms', code: '123456' })
  assert.equal(JSON.parse(seen[8].init.body).state, 'code-verified')
})

test('invalid code is retryable; resend cooldown prevents duplicate deliveries; disabled type rejected', async () => {
  const seen = []
  const api = new CabinetApi(sequence([...passwordSequence(), { body: codeDelivery }, { status: 400, body: { error: { innerErrors: [{ code: 'VERIFICATION_CODE_INVALID' }] } } }, { body: { state: 'done' } }, { body: ticket }, { body: { id: 'synthetic' } }], seen))
  const session = new Session(api, storage())
  await assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
  await session.sendCode('Email')
  await assert.rejects(session.sendCode('Email'), { code: 'RESEND_WAIT' })
  await assert.rejects(session.sendCode('Disabled'), { code: 'MULTI_FACTOR_STATE_EXPIRED' })
  await assert.rejects(session.verifyCode('Email', '654321'), { code: 'CODE_INVALID' })
  await session.verifyCode('Email', '123456')
  assert.equal(seen.filter(x => x.path === '/identity/sendcode').length, 1)
  assert.equal(session.hasSession, true)
})

test('authenticator verifies without sending messages; reload loses unfinished MFA', async () => {
  const store = storage(); const seen = []
  const session = new Session(new CabinetApi(sequence([...passwordSequence(), { body: { state: 'done' } }, { body: ticket }, { body: { id: 'synthetic' } }], seen)), store)
  await assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
  const reloaded = new Session(apiStub(), store)
  await assert.rejects(reloaded.verifyCode('GoogleAuthenticator', '123456'), { code: 'MULTI_FACTOR_STATE_EXPIRED' })
  assert.equal(await reloaded.check(), false)
  await session.verifyCode('GoogleAuthenticator', '123456')
  assert.equal(seen.some(x => x.path === '/identity/sendcode'), false)
})

test('cancel during MFA verification never saves late tokens and revokes them', async () => {
  let complete; let revoked = false
  const session = new Session(new CabinetApi(sequence(passwordSequence())), storage())
  await assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
  // Exercise the same asynchronous boundary with a synthetic challenge, no network credentials.
  const { FactorRequired } = await import('../src/auth/api.ts')
  const delayed = new Session(apiStub({ login: async () => { throw new FactorRequired({ types: ['GoogleAuthenticator'], send: async () => codeDelivery, verify: () => new Promise(resolve => { complete = resolve }) }) }, revoke: async () => { revoked = true } }), storage())
  await assert.rejects(delayed.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
  const verifying = assert.rejects(delayed.verifyCode('GoogleAuthenticator', '123456'), { code: 'SESSION_EXPIRED' })
  delayed.cancelLogin(); complete(tokens); await verifying
  assert.equal(delayed.hasSession, false); assert.equal(revoked, true)
})

test('expired challenge and send transport errors keep session closed', async () => {
  for (const failure of [new TypeError('offline'), { status: 400, body: { error: { innerErrors: [{ code: 'MULTI_FACTOR_STATE_EXPIRED' }] } } }]) {
    const session = new Session(new CabinetApi(sequence([...passwordSequence(), failure])), storage())
    await assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
    await assert.rejects(session.sendCode('Sms'))
    assert.equal(session.hasSession, false)
  }
})

test('disposing an idle login form does not invalidate another tab session check', async () => {
  let release
  const session = new Session(apiStub({ verify: () => new Promise(resolve => { release = resolve }) }), storage(tokens), () => 0)
  const check = session.check()
  await Promise.resolve()
  session.cancelLogin(); release()
  assert.equal(await check, true)
})

test('cancelling initial password request revokes the late session', async () => {
  let release; let revoked = false
  const session = new Session(apiStub({ login: () => new Promise(resolve => { release = resolve }), revoke: async () => { revoked = true } }), storage())
  const login = assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'SESSION_EXPIRED' })
  await Promise.resolve()
  session.cancelLogin(); release(tokens); await login
  assert.equal(session.hasSession, false); assert.equal(revoked, true)
})

test('server code lifetime and resend delay are enforced without hardcoded durations', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: 100000 })
  const session = new Session(new CabinetApi(sequence([...passwordSequence(), { body: { ...codeDelivery, expiresIn: 2, resendIn: 1 } }, { body: codeDelivery }])), storage())
  await assert.rejects(session.login('test@example.invalid', 'synthetic'), { code: 'FACTOR_REQUIRED' })
  const first = await session.sendCode('Sms')
  assert.equal(first.expiresAt, 102000); assert.equal(first.resendAt, 101000)
  context.mock.timers.setTime(102001)
  await assert.rejects(session.verifyCode('Sms', '123456'), { code: 'CODE_INVALID' })
  await session.sendCode('Sms')
  assert.equal(session.hasSession, false)
})


test('state writes serialize across tabs while a slow revoke cannot erase a new login', async () => {
  const shared = storage(tokens), stateLock = mutex(), refreshLock = mutex()
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const first = new Session(apiStub({ revoke: () => new Promise(resolve => { release = resolve; started() }) }), shared, () => 0, refreshLock, stateLock)
  const second = new Session(apiStub({ login: async () => ({ ...tokens, access: 'new-login' }) }), shared, () => 0, refreshLock, stateLock)
  const logout = first.logout()
  await ready
  await second.login('test@example.invalid', 'synthetic')
  release()
  await logout
  assert.equal(JSON.parse(shared.getItem(SESSION_KEY)).access, 'new-login')
  assert.equal(await second.check(), true)
})

test('cancelling login while waiting for the state lock sends no password request', async () => {
  const shared = storage(tokens), lock = mutex()
  let release
  const hold = lock(() => new Promise(resolve => { release = resolve }))
  await Promise.resolve()
  let requests = 0
  const session = new Session(apiStub({ login: async () => { requests++; return tokens } }), shared, () => 0, mutex(), lock)
  const login = assert.rejects(session.login('test@example.invalid', 'synthetic'))
  session.cancelLogin()
  release(); await hold; await login
  assert.equal(requests, 0)
  assert.equal(JSON.parse(shared.getItem(SESSION_KEY)).access, tokens.access)
})
