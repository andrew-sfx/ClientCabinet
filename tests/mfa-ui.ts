import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginForm } from '../src/LoginForm'
import { CabinetApi } from '../src/auth/api'
import { Session } from '../src/auth/session'
import '../src/styles.css'

// Dedicated dev test page; never imported by the product entry point.
const values = new Map<string, string>()
let passwordVerified = false
let codeVerified = false
const mfa = { error: { innerErrors: [{ code: 'MULTI_FACTOR_REQUIRED', details: { state: 'synthetic-state' } }] } }
const fakeFetch: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  const data = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {}
  let status = 200
  let body: unknown
  if (path === '/user/login/configuration') body = [{ identityTypeName: 'Password', isExternal: false }]
  else if (path === '/user/login') {
    if (!codeVerified) { status = 400; body = mfa }
    else body = { tokens: [{ grant_type: 'access_token', value: 'synthetic-access', expires_in: 300, token_type: 'Bearer' }, { grant_type: 'refresh_token', value: 'synthetic-refresh' }] }
  } else if (path === '/identity/configuration') body = { identityFactors: [{ code: passwordVerified ? 'SECOND_FACTOR' : 'FIRST_FACTOR', identityTypes: (passwordVerified ? ['Sms', 'Email', 'GoogleAuthenticator'] : ['Password']).map(name => ({ name, isEnabled: true })) }] }
  else if (path === '/identity/sendcode') body = { length: 6, expiresIn: 120, resendIn: 5, maskedContact: data.identityTypeName === 'Email' ? 't***@example.invalid' : '***12' }
  else if (path === '/identity/verify') {
    if (data.identityTypeName === 'Password') passwordVerified = true
    else if (data.code !== '123456') { status = 400; body = { error: { innerErrors: [{ code: 'VERIFICATION_CODE_INVALID' }] } } }
    else codeVerified = true
    body ??= { state: 'synthetic-verified-state' }
  } else if (path === '/user/account/summary') body = { id: 'synthetic' }
  else throw new Error('Unexpected test request')
  return new Response(JSON.stringify(body), { status })
}
const session = new Session(new CabinetApi(fakeFetch), { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } })
const root = createRoot(document.getElementById('test-root')!)
root.render(createElement('div', { className: 'page' }, createElement('main', { className: 'column' }, createElement(LoginForm, { session, notice: '', onSuccess: () => root.render(createElement('p', { role: 'status' }, 'Тест UI пройден: пароль → второй фактор → защищённый запрос. Настоящий API не использовался.')) }))))
