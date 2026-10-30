import { AuthError, CabinetApi } from './api.ts'
import { Session, SESSION_KEY, SESSION_LOCK } from './session.ts'
import type { Exclusive } from './session.ts'

const browserExclusive: Exclusive = operation => {
  if (!navigator.locks) return Promise.reject(new AuthError('BROWSER_UNSUPPORTED'))
  return navigator.locks.request(SESSION_LOCK, operation)
}

// Previous versions stored this exact key per tab. Do not revive that session.
try { sessionStorage.removeItem(SESSION_KEY) } catch { /* No legacy storage access. */ }

// Shared across StrictMode mounts. The browser lock also coordinates other tabs.
export const session = new Session(new CabinetApi(), {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
}, Date.now, browserExclusive, operation => {
  if (!navigator.locks) return Promise.reject(new AuthError('BROWSER_UNSUPPORTED'))
  return navigator.locks.request(SESSION_LOCK + ':state', operation)
})
