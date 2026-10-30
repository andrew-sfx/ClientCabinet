import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginForm } from '../src/LoginForm'
import { CabinetApi } from '../src/auth/api'
import { Session } from '../src/auth/session'
import '../src/styles.css'

// Dev-only browser regression tests. Every API operation uses this transport.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const root = createRoot(document.getElementById('test-root')!)
const output = document.getElementById('test-results')!
const messages: string[] = []
let failure = 'CREDENTIALS_INVALID'
let passwordVerified = false
let loginRequests = 0
let sendRequests = 0
let renderKey = 0
const fakeFetch: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  const data = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {}
  let body: unknown
  let status = 200
  if (path === '/user/login/configuration') body = [{ identityTypeName: 'Password', isExternal: false }]
  else if (path === '/user/login') {
    loginRequests++
    status = 400
    body = { error: { innerErrors: [{ code: failure || 'MULTI_FACTOR_REQUIRED', details: { state: 'synthetic-state' } }] } }
  } else if (path === '/identity/configuration') body = { identityFactors: [{ code: passwordVerified ? 'SECOND_FACTOR' : 'FIRST_FACTOR', identityTypes: (passwordVerified ? ['Sms', 'Email', 'GoogleAuthenticator'] : ['Password']).map(name => ({ name, isEnabled: true })) }] }
  else if (path === '/identity/verify') {
    if (data.identityTypeName === 'Password') { passwordVerified = true; body = { state: 'synthetic-verified' } }
    else { status = 400; body = { error: { innerErrors: [{ code: 'VERIFICATION_CODE_INVALID' }] } } }
  } else if (path === '/identity/sendcode') {
    sendRequests++
    body = { length: 6, expiresIn: 120, resendIn: 1, maskedContact: '***12' }
  } else throw new Error('Unexpected synthetic request: ' + path)
  return new Response(JSON.stringify(body), { status })
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function get<T extends Element>(selector: string) { const element = document.querySelector<T>(selector); assert(element, 'Missing ' + selector); return element }
async function fill(selector: string, value: string) {
  await act(async () => {
    const element = get<HTMLInputElement>(selector)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function settle() {
  for (let attempt = 0; get('form').getAttribute('aria-busy') === 'true' && attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  assert(get('form').getAttribute('aria-busy') === 'false', 'Request did not settle')
}
async function submit() { await act(async () => get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await settle() }
async function mount(code: string) {
  failure = code; passwordVerified = false; loginRequests = 0; sendRequests = 0
  const values = new Map<string, string>()
  const session = new Session(new CabinetApi(fakeFetch), { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } })
  await act(async () => root.render(createElement(LoginForm, { key: ++renderKey, session, notice: '', onSuccess: () => { throw new Error('Unexpected login success') } })))
  await fill('#identifier', 'test@example.invalid'); await submit()
}
async function check(name: string, run: () => Promise<void>) {
  try { await run(); messages.push('PASS ' + name) }
  catch (error) { messages.push('FAIL ' + name + ': ' + String(error)); throw error }
  finally { output.textContent = messages.join('\n') }
}
async function run() {
  await check('L7 password step moves focus into the password field', async () => {
    await mount('CREDENTIALS_INVALID')
    assert(document.activeElement === get('#password'), 'Password not focused')
    assert(get('#password').matches(':focus-visible'), 'Password has no visible focus')
    assert(loginRequests === 0, 'Identifier step called login')
  })
  await check('L8 invalid credentials render one inline error associated with the password', async () => {
    await fill('#password', 'Synthetic-123'); await submit()
    assert(get('#password').getAttribute('aria-invalid') === 'true', 'Password not invalid')
    assert(get('#message').classList.contains('field-error'), 'Error is not inline')
    assert(!!get('#message').querySelector('svg'), 'Missing error icon')
    assert(!document.querySelector('.login-lockout'), 'Wrong lockout block')
    assert(!get<HTMLButtonElement>('.primary').disabled, 'Retry disabled for invalid credentials')
  })
  for (const code of ['TOO_MANY_LOGIN_ATTEMPTS', 'TOO_MANY_ATTEMPTS', 'USER_LOCKED_OUT', 'RATE_LIMIT']) {
    await check('L9 separate lockout and disabled submit for ' + code, async () => {
      await mount(code); await fill('#password', 'Synthetic-123'); await submit()
      assert(get('.login-lockout strong').textContent === 'Вход временно ограничен', 'Missing lockout title')
      assert(!!get('.login-lockout').querySelector('svg'), 'Missing lock icon')
      assert(!document.querySelector('.field-error'), 'Lockout is a password error')
      assert(get<HTMLButtonElement>('.primary').disabled, 'Login enabled while locked')
      const before = loginRequests; await submit()
      assert(loginRequests === before, 'Enter/programmatic submit bypassed lockout')
      await act(async () => get<HTMLButtonElement>('.back').click())
      assert(!!get('#identifier') && !document.querySelector('.login-lockout'), 'Back did not clear lockout')
    })
  }
  await check('L11 resend timer and link are mutually exclusive, including after resend', async () => {
    await mount(''); await fill('#password', 'Synthetic-123'); await submit()
    assert(get('.code-resend').textContent?.includes('Отправить повторно через'), 'Timer missing')
    assert(!document.querySelector('.resend'), 'Resend link visible during timer')
    assert(sendRequests === 1, 'Unexpected initial send count')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)) })
    assert(!!get('.resend'), 'Resend link missing after timer')
    assert(!get('.code-resend').textContent?.includes('через'), 'Timer remains after expiry')
    await act(async () => get<HTMLButtonElement>('.resend').click())
    await settle()
    assert(!document.querySelector('.resend') && get('.code-resend').textContent?.includes('через'), 'Resend did not restore timer alone')
    assert(Number(sendRequests) === 2, 'Resend did not call transport once')
  })
  await check('L10 wrong code clears digits and restores focus to the first slot', async () => {
    await fill('#code', '123456'); await submit()
    assert(get<HTMLInputElement>('#code').value === '', 'Code retained')
    assert(document.activeElement === get('#code'), 'Code input not focused')
    assert(get('.code-slots span').getAttribute('data-active') === 'true', 'First slot not active')
    assert(document.querySelectorAll('.code-slots i').length === 1, 'Missing group separator')
  })
  await act(async () => root.unmount())
  output.dataset.result = 'passed'
  output.textContent += `\n${messages.length} UI tests passed. Real API requests: 0.`
}
void run().catch(() => { output.dataset.result = 'failed' })
