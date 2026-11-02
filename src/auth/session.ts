import { AuthError, CabinetApi, FactorRequired, object } from './api.ts'
import type { Tokens, CodeChallenge, AccountSummary } from './api.ts'

import { authConfig, sessionKeys } from './config.ts'

const keys = sessionKeys(authConfig)
export const SESSION_KEY = keys.key
export const SESSION_EPOCH_KEY = keys.epoch
export const SESSION_LOCK = keys.lock
export const SESSION_REVOKE_FAILED_KEY = `${keys.lock}.revoke-failed`
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>

export class Session {
  private api: CabinetApi
  private storage: StoragePort
  private now: () => number
  private stateExclusive: Exclusive
  private exclusive: Exclusive
  private tokens?: Tokens
  private loginAttempt = 0
  private loginRevision?: number
  private pending?: { challenge: CodeChallenge; revision: number }
  private epoch = ''
  private revision = 0
  private refreshing?: Promise<void>
  private refreshRevision = -1
  private checking?: Promise<boolean>
  private checkRevision = -1
  private accountSummary?: AccountSummary
  constructor(api: CabinetApi, storage: StoragePort, now: () => number = Date.now, exclusive: Exclusive = operation => operation(), stateExclusive: Exclusive = operation => operation()) {
    this.api = api; this.storage = storage; this.now = now; this.exclusive = exclusive; this.stateExclusive = stateExclusive
    this.sync()
  }
  // localStorage is authoritative, including when a tab was asleep and missed events.
  sync() {
    try {
      const epoch = this.storage.getItem(SESSION_EPOCH_KEY) || ''
      if (epoch !== this.epoch) { this.epoch = epoch; this.revision++; this.pending = undefined; this.loginRevision = undefined; this.accountSummary = undefined }
      const value = object(JSON.parse(this.storage.getItem(SESSION_KEY) || 'null'))
      this.tokens = typeof value.access === 'string' && value.access && typeof value.refresh === 'string' && value.refresh && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
        ? value as unknown as Tokens : undefined
      if (!this.tokens) this.accountSummary = undefined
    } catch { this.tokens = undefined; this.accountSummary = undefined; this.revision++ }
  }
  get hasSession() { this.sync(); return !!this.tokens }
  get expiresAt() { this.sync(); return this.tokens?.expiresAt ?? 0 }
  get summary() { this.sync(); return this.accountSummary }
  get accountRevision() { this.sync(); return this.revision }
  private clear() {
    this.revision++; this.tokens = undefined; this.pending = undefined; this.loginRevision = undefined; this.accountSummary = undefined
    this.epoch = crypto.randomUUID()
    try {
      this.storage.setItem(SESSION_EPOCH_KEY, this.epoch)
    } finally {
      // Removing credentials must still be attempted if writing the epoch fails.
      this.storage.removeItem(SESSION_KEY)
    }
  }
  private invalidate(revision?: number) {
    return this.stateExclusive(async () => {
      if (revision !== undefined) this.assertCurrent(revision)
      this.clear()
      return this.revision
    })
  }
  private assertCurrent(revision: number) {
    this.sync()
    if (revision !== this.revision) throw new AuthError('SESSION_EXPIRED')
  }
  private save(tokens: Tokens, revision: number) {
    this.assertCurrent(revision)
    try { this.storage.setItem(SESSION_KEY, JSON.stringify(tokens)) }
    catch { this.tokens = undefined; throw new AuthError('STORAGE_UNAVAILABLE') }
    this.tokens = tokens
  }
  async login(email: string, password: string) {
    const attempt = ++this.loginAttempt
    let revision: number
    try { revision = await this.stateExclusive(async () => {
      if (attempt !== this.loginAttempt) throw new AuthError('SESSION_EXPIRED')
      this.clear()
      this.loginRevision = this.revision
      return this.revision
    }) } catch (error) { if (error instanceof AuthError) throw error; throw new AuthError('STORAGE_UNAVAILABLE') }
    if (attempt !== this.loginAttempt) throw new AuthError('SESSION_EXPIRED')
    this.assertCurrent(revision)
    let tokens: Tokens
    try { tokens = await this.api.login(email, password) }
    catch (error) {
      if (this.loginRevision === revision) this.loginRevision = undefined
      this.assertCurrent(revision)
      if (error instanceof FactorRequired) this.pending = { challenge: error.challenge, revision }
      throw error
    }
    try { await this.finishLogin(tokens, revision) }
    finally { if (this.loginRevision === revision) this.loginRevision = undefined }
  }
  cancelLogin() {
    this.loginAttempt++
    if (this.pending || this.loginRevision !== undefined) { this.pending = undefined; this.loginRevision = undefined; this.revision++ }
  }
  async register(operation: () => Promise<Tokens>) {
    let revision: number
    try { revision = await this.invalidate() } catch { throw new AuthError('STORAGE_UNAVAILABLE') }
    const tokens = await operation()
    await this.finishLogin(tokens, revision)
  }
  async sendCode(type: string) {
    const pending = this.pending
    if (!pending) throw new AuthError('MULTI_FACTOR_STATE_EXPIRED')
    this.assertCurrent(pending.revision)
    const delivery = await pending.challenge.send(type)
    this.assertCurrent(pending.revision)
    return delivery
  }
  async verifyCode(type: string, code: string) {
    const pending = this.pending
    if (!pending) throw new AuthError('MULTI_FACTOR_STATE_EXPIRED')
    this.assertCurrent(pending.revision)
    let tokens: Tokens
    try { tokens = await pending.challenge.verify(type, code) }
    catch (error) {
      this.assertCurrent(pending.revision)
      if (error instanceof FactorRequired) this.pending = { challenge: error.challenge, revision: pending.revision }
      throw error
    }
    this.pending = undefined
    this.loginRevision = pending.revision
    try { await this.finishLogin(tokens, pending.revision) }
    finally { if (this.loginRevision === pending.revision) this.loginRevision = undefined }
  }
  private async finishLogin(tokens: Tokens, revision: number) {
    try {
      const summary = await this.api.verify(tokens.access)
      await this.stateExclusive(async () => this.save(tokens, revision))
      this.assertCurrent(revision)
      this.accountSummary = summary
    } catch (error) {
      try { await this.api.revoke(tokens.access) } catch { /* Best effort for an uncommitted session. */ }
      throw error
    }
  }
  private refresh(failedAccess?: string): Promise<void> {
    if (this.refreshing && this.refreshRevision === this.revision) return this.refreshing
    const revision = this.revision
    this.refreshRevision = revision
    const requestedAccess = this.tokens?.access
    const refreshing = this.exclusive(async () => {
      this.assertCurrent(revision)
      const tokens = this.tokens
      if (!tokens) throw new AuthError('SESSION_EXPIRED')
      // A different tab may already have rotated the token while this one waited.
      if (tokens.access !== requestedAccess) return
      if (failedAccess ? tokens.access !== failedAccess : tokens.expiresAt - this.now() > 60000) return
      // Arm cleanup before issuing a token: a failed flag write cannot hide a late revoke.
      try { this.storage.setItem(SESSION_REVOKE_FAILED_KEY, this.epoch) }
      catch { throw new AuthError('STORAGE_UNAVAILABLE') }
      const next = await this.api.refresh(tokens.refresh)
      try { await this.stateExclusive(async () => this.save(next, revision)) }
      catch (error) {
        try {
          await this.api.revoke(next.access)
          this.storage.removeItem(SESSION_REVOKE_FAILED_KEY)
        } catch { /* Leave the shared marker until logout consumes it. */ }
        throw error
      }
      try { this.storage.removeItem(SESSION_REVOKE_FAILED_KEY) } catch { /* Logout reports uncertain cleanup. */ }
    }).catch(async error => {
      this.sync()
      if (revision === this.revision && error instanceof AuthError && [400, 401, 403].includes(error.status)) {
        await this.invalidate(revision); throw new AuthError('SESSION_EXPIRED')
      }
      throw error
    }).finally(() => { if (this.refreshing === refreshing) this.refreshing = undefined })
    this.refreshing = refreshing
    return refreshing
  }
  check(): Promise<boolean> {
    this.sync()
    if (this.checking && this.checkRevision === this.revision) return this.checking
    this.checkRevision = this.revision
    const checking = this.verify().finally(() => { if (this.checking === checking) this.checking = undefined })
    this.checking = checking
    return checking
  }
  async authenticated<T>(operation: (access: string) => Promise<T>): Promise<T> {
    this.sync()
    if (!this.tokens) throw new AuthError('SESSION_EXPIRED')
    const revision = this.revision
    let refreshed = false
    if (this.tokens.expiresAt - this.now() <= 60000) { await this.refresh(); refreshed = true }
    this.assertCurrent(revision)
    if (!this.tokens) throw new AuthError('SESSION_EXPIRED')
    const access = this.tokens.access
    let result: T
    try { result = await operation(access) }
    catch (error) {
      this.assertCurrent(revision)
      if (!(error instanceof AuthError) || error.status !== 401) throw error
      if (refreshed) { await this.invalidate(revision); throw new AuthError('SESSION_EXPIRED') }
      await this.refresh(access)
      this.assertCurrent(revision)
      if (!this.tokens) throw new AuthError('SESSION_EXPIRED')
      try { result = await operation(this.tokens.access) }
      catch (retry) {
        this.assertCurrent(revision)
        if (retry instanceof AuthError && retry.status === 401) { await this.invalidate(revision); throw new AuthError('SESSION_EXPIRED') }
        throw retry
      }
    }
    this.assertCurrent(revision)
    if (!this.tokens) throw new AuthError('SESSION_EXPIRED')
    return result
  }
  private async verify(): Promise<boolean> {
    this.sync()
    if (!this.tokens) return false
    const revision = this.revision
    const summary = await this.authenticated(access => this.api.verify(access))
    this.assertCurrent(revision)
    this.accountSummary = summary
    return true
  }
  async logout(): Promise<boolean> {
    this.sync()
    let previous: Tokens | undefined
    const pending = this.refreshing
    let previousEpoch = this.epoch
    let cleared = true
    try { await this.stateExclusive(async () => { this.sync(); previous = this.tokens; previousEpoch = this.epoch; this.clear() }) } catch { cleared = false }
    if (pending) { try { await pending } catch { /* Invalidated by clear(). */ } }
    // The cross-tab lock waits for any other tab's in-flight refresh cleanup.
    return this.exclusive(async () => {
      let revokeFailed: boolean
      try {
        const marker = this.storage.getItem(SESSION_REVOKE_FAILED_KEY)
        // Epoch scoping keeps an old failure from affecting a later login/clear.
        revokeFailed = marker !== null && marker === previousEpoch
        // Check writes as well as reads; storage failure always makes logout uncertain.
        this.storage.setItem(SESSION_REVOKE_FAILED_KEY, marker ?? '')
        this.storage.removeItem(SESSION_REVOKE_FAILED_KEY)
      } catch { revokeFailed = true }
      if (!previous) return cleared && !revokeFailed
      try { await this.api.revoke(previous.access); return cleared && !revokeFailed } catch { return false }
    }).catch(() => false)
  }
}
