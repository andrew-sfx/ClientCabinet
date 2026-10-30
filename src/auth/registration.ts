import { AuthError, CabinetApi, object } from './api.ts'
import type { Tokens } from './api.ts'
import { authConfig } from './config.ts'

export interface Country { code: string; name: string }
export interface RegistrationInput { country: string; email: string; password: string; corporate: boolean }
export type RegistrationState = 'r1' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r9b'
export const passwordRules = (value: string) => [value.length >= 10, /[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value)]
export function validation(input: RegistrationInput, countries: Country[]) {
  return {
    country: countries.some(country => country.code === input.country) ? '' : 'Выберите страну проживания',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ? '' : 'Проверьте формат email',
    password: passwordRules(input.password).every(Boolean) ? '' : 'Пароль не соответствует требованиям',
  }
}

// One controller owns one provisional user. Correctable Identity errors reuse it.
// Only the injected session operation may persist tokens after all steps and verification.
export class Registration {
  state: RegistrationState = 'r1'
  passwordError = false
  private tokens?: Tokens
  private disposed = false
  private api: CabinetApi
  private complete: (operation: () => Promise<Tokens>) => Promise<void>
  private personalAvailable = false
  countries: Country[] = []
  constructor(api: CabinetApi, complete: (operation: () => Promise<Tokens>) => Promise<void>) {
    this.api = api; this.complete = complete
  }
  async configuration() {
    const query = new URLSearchParams({ domainName: authConfig.domainName })
    const [countries, types] = await Promise.all([
      this.api.request('/profile/country?' + query), this.api.request('/verification/user/type?' + query),
    ])
    if (!Array.isArray(countries) || !countries.length || countries.some(c => typeof object(c).code !== 'string' || typeof object(c).name !== 'string')) throw new AuthError('INVALID_RESPONSE')
    if (!Array.isArray(types) || !types.some(t => object(t).name === 'Personal')) throw new AuthError('INVALID_RESPONSE')
    this.countries = countries.map(c => ({ code: object(c).code as string, name: object(c).name as string }))
    this.personalAvailable = true
    return this.countries
  }
  async submit(input: RegistrationInput) {
    if (this.disposed || ['r4', 'r7', 'r9b'].includes(this.state)) return
    if (!this.personalAvailable || input.corporate) return
    if (Object.values(validation(input, this.countries)).some(Boolean)) { this.state = 'r3'; return }
    this.state = 'r4'; this.passwordError = false
    let step = 'start'
    try {
      await this.complete(async () => {
        this.tokens ??= await this.api.startRegistration()
        if (this.disposed) throw new AuthError('SESSION_EXPIRED')
        const { domainName } = authConfig
        step = 'identity'
        // Separate fields follow the reference signUp and DTO. .com is blocked
        // before payload validation; no alternative serialization is guessed.
        await this.api.post('/identity/update', { domainName, identityTypeName: 'Password', login: input.email.trim(), password: input.password }, this.tokens.access)
        step = 'profile'
        const results = await Promise.allSettled([
          this.api.post('/verification/user/type/update', { domainName, userType: 'Personal' }, this.tokens.access).then(result => { if (result !== true) throw new AuthError('INVALID_RESPONSE') }),
          this.api.post('/profile/type/personal', { domainName, country: input.country }, this.tokens.access),
          this.api.post('/profile/contact', { domainName, contactMethod: 'Email', value: input.email.trim(), isSubscribeToNotification: false }, this.tokens.access),
        ])
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
        if (this.disposed) throw new AuthError('SESSION_EXPIRED')
        step = 'session'
        return this.tokens
      })
      this.tokens = undefined
      this.state = 'r9b'
    } catch (error) {
      if (step === 'identity' && error instanceof AuthError && ['LOGIN_IN_USE', 'PASSWORD_LENGTH_INVALID'].includes(error.code) && !this.disposed) {
        this.passwordError = error.code === 'PASSWORD_LENGTH_INVALID'
        this.state = this.passwordError ? 'r3' : 'r5'
      } else {
        const unavailable = error instanceof AuthError && ['NETWORK', 'UNAVAILABLE'].includes(error.code)
        this.state = step === 'start' && !this.tokens && unavailable ? 'r6' : 'r7'
        await this.revoke()
      }
    }
  }
  private async revoke() {
    const tokens = this.tokens; this.tokens = undefined
    if (tokens) { try { await this.api.revoke(tokens.access) } catch { /* Best effort; never treat cleanup failure as success. */ } }
  }
  async dispose() { this.disposed = true; await this.revoke() }
}
