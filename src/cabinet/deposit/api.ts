import { AuthError, CabinetApi } from '../../auth/api.ts'
import { authConfig } from '../../auth/config.ts'
import type { Session } from '../../auth/session.ts'
import { depositMethods, parseConfigs } from './model.ts'

export class DepositApi {
  private session: Session
  private fetcher: typeof fetch
  constructor(session: Session, fetcher: typeof fetch = fetch) {
    this.session = session
    this.fetcher = fetcher
  }
  async methods(signal: AbortSignal) {
    const revision = this.session.accountRevision
    const assertCurrent = () => {
      signal.throwIfAborted()
      if (!this.session.hasSession || this.session.accountRevision !== revision)
        throw new AuthError('SESSION_EXPIRED')
    }
    const api = new CabinetApi((url, init) => {
      assertCurrent()
      const fetcher = this.fetcher
      return fetcher(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          ...(init?.signal ? [init.signal] : []),
        ]),
      })
    })
    const read = (grade: boolean) =>
      this.session.authenticated((access) => {
        assertCurrent()
        const query = new URLSearchParams({
          financeOperationTypeName: 'Add',
          isExternal: 'true',
          isVisible: 'true',
          domainName: authConfig.domainName,
          ...(grade ? { checkGrade: 'true' } : {}),
        })
        return api.request('/paymentsystem/configuration?' + query, {}, access)
      })
    const [configs, grades] = await Promise.all([read(false), read(true)])
    assertCurrent()
    return depositMethods(parseConfigs(configs), parseConfigs(grades))
  }
}
