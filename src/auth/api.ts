import { authConfig } from './config.ts'

const { apiUrl: API_URL, domainName: DOMAIN_NAME } = authConfig

type Json = Record<string, unknown>
export function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

export class AuthError extends Error {
  status: number
  code: string
  state?: string
  constructor(code: string, status = 0, state?: string) {
    super(code)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.state = state
  }
}

export function errorMessage(error: unknown): string {
  const code = error instanceof AuthError ? error.code : 'UNKNOWN'
  if (['VERIFICATION_CODE_INVALID', 'CREDENTIALS_INVALID', 'USER_NOT_FOUND', 'IDENTITY_NOT_FOUND'].includes(code)) return 'Не удалось войти. Проверьте email или телефон и пароль.'
  if (code === 'PASSWORD_NOT_VERIFIED') return 'Сервер выдал сессию без проверки пароля. Вход остановлен. Обратитесь к администратору.'
  if (code === 'MULTI_FACTOR_STATE_EXPIRED') return 'Время подтверждения истекло. Начните вход заново.'
  if (code === 'CODE_INVALID') return 'Неверный код. Проверьте его и попробуйте снова.'
  if (code === 'RESEND_WAIT') return 'Подождите перед повторной отправкой кода.'
  if (code === 'ADDITIONAL_FACTOR') return 'Сервер требует дополнительное подтверждение входа. Этот способ пока не поддерживается. Обратитесь к администратору.'
  if (code === 'PASSWORD_DISABLED') return 'Вход по паролю недоступен для этой конфигурации. Обратитесь к администратору.'
  if (code === 'SESSION_EXPIRED') return 'Сессия истекла. Войдите снова.'
  if (code === 'STORAGE_UNAVAILABLE') return 'Браузер запретил хранение сессии. Разрешите данные сайта и повторите вход.'
  if (code === 'BROWSER_UNSUPPORTED') return 'Для безопасного обновления сессии нужен современный браузер и HTTPS (или localhost при локальном запуске).'
  if (['TOO_MANY_LOGIN_ATTEMPTS', 'TOO_MANY_ATTEMPTS', 'USER_LOCKED_OUT', 'RATE_LIMIT'].includes(code)) return 'Вход временно ограничен. Подождите и попробуйте позже или обратитесь к администратору.'
  if (code === 'TIMEOUT') return 'Время ожидания ответа сервера истекло. Попробуйте ещё раз.'
  if (code === 'NETWORK') return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
  if (code === 'UNAVAILABLE') return 'Сервер временно недоступен. Попробуйте позже.'
  if (error instanceof AuthError && error.status === 403) return 'Сервер ограничил доступ. Обратитесь к администратору.'
  return 'Не удалось завершить запрос. Повторите попытку. Если ошибка повторится, обратитесь к администратору.'
}

export interface Tokens { access: string; refresh: string; expiresAt: number }
export interface SummaryAccount { accountNumber?: string; type?: string; platformType?: string; productCode?: string; name?: string }
export interface AccountSummary { firstName?: string; lastName?: string; email?: string; mainAccountNumber?: string; accounts?: SummaryAccount[] }
const optionalText = (value: unknown) => typeof value === 'string' && value ? value : undefined

function tokenPair(access: unknown, refresh: unknown, seconds: unknown, now: number): Tokens {
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new AuthError('INVALID_RESPONSE')
  return { access, refresh, expiresAt: now + seconds * 1000 }
}

export class CabinetApi {
  private fetcher: typeof fetch
  private now: () => number
  constructor(fetcher: typeof fetch = fetch, now: () => number = Date.now) { this.fetcher = fetcher; this.now = now }

  async request(path: string, init: RequestInit = {}, access?: string, timeoutMs = 15000): Promise<unknown> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (access) headers.set('Authorization', `Bearer ${access}`)
    const signal = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      const fetcher = this.fetcher
      response = await fetcher(`${API_URL}${path}`, { ...init, headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal })
    } catch { throw new AuthError(signal.aborted && signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK') }
    let body: unknown
    try { const text = await response.text(); body = text ? JSON.parse(text) : null } catch {
      if (signal.aborted && signal.reason?.name === 'TimeoutError') throw new AuthError('TIMEOUT')
      throw new AuthError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE', response.status)
    }
    if (!response.ok) {
      const outer = object(object(body).error)
      const inner = Array.isArray(outer.innerErrors) ? object(outer.innerErrors[0]) : outer
      const code = response.status >= 500 ? 'UNAVAILABLE' : response.status === 429 ? 'RATE_LIMIT' : typeof inner.code === 'string' ? inner.code : 'REQUEST_FAILED'
      const state = object(inner.details).state
      throw new AuthError(code, response.status, typeof state === 'string' ? state : undefined)
    }
    return body
  }

  post(path: string, body: unknown, access?: string, timeoutMs?: number) {
    return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, access, timeoutMs)
  }

  async configuration(): Promise<void> {
    const value = await this.request(`/user/login/configuration?${new URLSearchParams({ domainName: DOMAIN_NAME })}`)
    if (!Array.isArray(value)) throw new AuthError('INVALID_RESPONSE')
    if (!value.some(item => object(item).identityTypeName === 'Password' && object(item).isExternal === false)) throw new AuthError('PASSWORD_DISABLED')
  }

  async login(identifier: string, password: string): Promise<Tokens> {
    await this.configuration()
    let ticket: unknown
    try { ticket = await this.post('/user/login', { domainName: DOMAIN_NAME, identifier }) }
    catch (error) {
      if (!(error instanceof AuthError) || error.code !== 'MULTI_FACTOR_REQUIRED' || !error.state) throw error
      const configuration = object(await this.request(`/identity/configuration?${new URLSearchParams({ domainName: DOMAIN_NAME, state: error.state })}`))
      const factors = configuration.identityFactors
      if (!Array.isArray(factors) || factors.length === 0) throw new AuthError('INVALID_RESPONSE')
      const factor = object(factors[0])
      if (!Array.isArray(factor.identityTypes) || !factor.identityTypes.some(type => object(type).name === 'Password' && object(type).isEnabled === true)) throw new AuthError('ADDITIONAL_FACTOR')
      if (typeof factor.code !== 'string') throw new AuthError('INVALID_RESPONSE')
      const verified = object(await this.post('/identity/verify', {
        domainName: DOMAIN_NAME, state: typeof configuration.state === 'string' ? configuration.state : error.state,
        identityFactorCode: factor.code, identityTypeName: 'Password', key: identifier, code: password,
      }))
      if (typeof verified.state !== 'string' || !verified.state) throw new AuthError('INVALID_RESPONSE')
      return this.continueLogin(identifier, verified.state)
    }
    {
      const issued = object(ticket).tokens
      if (Array.isArray(issued)) {
        for (const item of issued) {
          const token = object(item)
          if (token.grant_type === 'access_token' && typeof token.value === 'string' && token.value) {
            try { await this.revoke(token.value) } catch { /* Reject even if cleanup is unavailable. */ }
          }
        }
      }
      throw new AuthError('PASSWORD_NOT_VERIFIED')
    }
  }

  private parseTicket(ticket: unknown): Tokens {
    const tokens = object(ticket).tokens
    if (!Array.isArray(tokens)) throw new AuthError('INVALID_RESPONSE')
    const access = object(tokens.find(t => object(t).grant_type === 'access_token'))
    const refresh = object(tokens.find(t => object(t).grant_type === 'refresh_token'))
    if (access.token_type !== 'Bearer') throw new AuthError('INVALID_RESPONSE')
    return tokenPair(access.value, refresh.value, access.expires_in, this.now())
  }

  private async continueLogin(identifier: string, state: string): Promise<Tokens> {
    let ticket: unknown
    try { ticket = await this.post('/user/login', { domainName: DOMAIN_NAME, identifier, state }) }
    catch (error) {
      if (!(error instanceof AuthError) || error.code !== 'MULTI_FACTOR_REQUIRED' || !error.state) throw error
      throw new FactorRequired(await this.challenge(identifier, error.state))
    }
    return this.parseTicket(ticket)
  }

  private async challenge(identifier: string, state: string): Promise<CodeChallenge> {
    const configuration = object(await this.request('/identity/configuration?' + new URLSearchParams({ domainName: DOMAIN_NAME, state })))
    if (typeof configuration.state === 'string' && configuration.state) state = configuration.state
    const factors = configuration.identityFactors
    if (!Array.isArray(factors) || !factors.length) throw new AuthError('INVALID_RESPONSE')
    const factor = object(factors[0])
    if (typeof factor.code !== 'string' || !factor.code || !Array.isArray(factor.identityTypes)) throw new AuthError('INVALID_RESPONSE')
    const factorCode = factor.code
    const types = factor.identityTypes.map(object).filter(t => t.isEnabled === true && t.isExternal !== true && ['Email', 'Sms', 'GoogleAuthenticator'].includes(String(t.name))).map(t => String(t.name))
    if (!types.length) throw new AuthError('ADDITIONAL_FACTOR')
    const post = (path: string, body: unknown) => this.post(path, body)
    const continueLogin = (nextState: string) => this.continueLogin(identifier, nextState)
    const sent = new Map<string, CodeDelivery>()
    let inFlight = false
    let consumed = false
    const allowed = (type: string) => { if (!types.includes(type) || consumed) throw new AuthError('MULTI_FACTOR_STATE_EXPIRED') }
    return {
      types,
      async send(type: string) {
        allowed(type)
        if (type === 'GoogleAuthenticator') throw new AuthError('INVALID_RESPONSE')
        const previous = sent.get(type)
        if (previous && previous.resendAt > Date.now()) throw new AuthError('RESEND_WAIT')
        if (inFlight) throw new AuthError('REQUEST_IN_PROGRESS')
        inFlight = true
        try {
          const response = object(await post('/identity/sendcode', { domainName: DOMAIN_NAME, state, identityTypeName: type }))
          if (!Number.isInteger(response.length) || Number(response.length) < 1 || Number(response.length) > 64 || typeof response.expiresIn !== 'number' || !Number.isFinite(response.expiresIn) || response.expiresIn <= 0 || typeof response.resendIn !== 'number' || !Number.isFinite(response.resendIn) || response.resendIn < 0 || typeof response.maskedContact !== 'string') throw new AuthError('INVALID_RESPONSE')
          const delivery = { length: Number(response.length), expiresAt: Date.now() + response.expiresIn * 1000, resendAt: Date.now() + response.resendIn * 1000, maskedContact: response.maskedContact }
          sent.set(type, delivery)
          return delivery
        } finally { inFlight = false }
      },
      async verify(type: string, code: string) {
        allowed(type)
        if (inFlight) throw new AuthError('REQUEST_IN_PROGRESS')
        const delivery = sent.get(type)
        if (type !== 'GoogleAuthenticator' && (!delivery || delivery.expiresAt <= Date.now() || code.length !== delivery.length)) throw new AuthError('CODE_INVALID')
        inFlight = true
        try {
          let result: Json
          try { result = object(await post('/identity/verify', { domainName: DOMAIN_NAME, state, identityFactorCode: factorCode, identityTypeName: type, code })) }
          catch (error) { if (error instanceof AuthError && error.code === 'VERIFICATION_CODE_INVALID') throw new AuthError('CODE_INVALID', error.status); throw error }
          if (typeof result.state !== 'string' || !result.state) throw new AuthError('INVALID_RESPONSE')
          state = result.state
          // Verification consumed this challenge even if the following login request fails.
          consumed = true
          return continueLogin(state)
        } finally { inFlight = false }
      },
    }
    // Captured only in memory; never persist challenge state or verification codes.
  }

  async refresh(refresh: string): Promise<Tokens> {
    const response = object(await this.request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }) }))
    if (response.token_type?.toString().toLowerCase() !== 'bearer') throw new AuthError('INVALID_RESPONSE')
    return tokenPair(response.access_token, response.refresh_token, response.expires_in, this.now())
  }

  async startRegistration(): Promise<Tokens> {
    const response = object(object(await this.post('/user/registration', { domainName: DOMAIN_NAME })).token)
    try {
      if (response.token_type?.toString().toLowerCase() !== 'bearer') throw new AuthError('INVALID_RESPONSE')
      return tokenPair(response.access_token, response.refresh_token, response.expires_in, this.now())
    } catch {
      if (typeof response.access_token === 'string' && response.access_token) {
        try { await this.revoke(response.access_token) } catch { /* Best effort for a malformed provisional session. */ }
      }
      throw new AuthError('INVALID_RESPONSE', 200)
    }
  }

  async verify(access: string): Promise<AccountSummary> {
    const result = object(await this.request('/user/account/summary', { method: 'POST' }, access))
    if (typeof result.id !== 'string' || !result.id) throw new AuthError('INVALID_RESPONSE')
    // Keep only home-screen fields, in memory; never persist the profile with tokens.
    return {
      firstName: optionalText(result.firstName), lastName: optionalText(result.lastName), email: optionalText(result.email),
      mainAccountNumber: optionalText(result.mainAccountNumber),
      accounts: Array.isArray(result.accounts) ? result.accounts.map(item => {
        const value = object(item)
        return { accountNumber: optionalText(value.accountNumber), type: optionalText(value.type), platformType: optionalText(value.platformType), productCode: optionalText(value.productCode), name: optionalText(value.name) }
      }) : undefined,
    }
  }

  async revoke(access: string): Promise<void> { await this.request('/token/revoke', { method: 'POST' }, access) }
}

export interface CodeDelivery { length: number; expiresAt: number; resendAt: number; maskedContact: string }
export interface CodeChallenge { types: string[]; send(type: string): Promise<CodeDelivery>; verify(type: string, code: string): Promise<Tokens> }
export class FactorRequired extends AuthError {
  challenge: CodeChallenge
  constructor(challenge: CodeChallenge) { super('FACTOR_REQUIRED'); this.challenge = challenge }
}
