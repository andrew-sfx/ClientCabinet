import { useCallback, useEffect, useState } from 'react'
import { AuthError } from '../auth/api'

type Resource<T> = { state: 'loading' } | { state: 'error'; timedOut: boolean } | { state: 'ready'; data: T }

// Refresh visible data on return, reconnect and once a minute. Never overlap requests.
export function useResource<T>(load: () => Promise<T>, onSessionLost: () => void, initial?: T) {
  const [result, setResult] = useState<Resource<T>>(initial === undefined ? { state: 'loading' } : { state: 'ready', data: initial })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, pending = false
    const refresh = async () => {
      if (pending || !active) return
      pending = true
      try {
        const data = await load()
        if (active) setResult({ state: 'ready', data })
      } catch (error) {
        if (!active) return
        if (error instanceof AuthError && error.code === 'SESSION_EXPIRED') onSessionLost()
        else setResult({ state: 'error', timedOut: error instanceof AuthError && error.code === 'TIMEOUT' })
      } finally { pending = false }
    }
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    if (initial === undefined || attempt > 0) void refresh()
    const timer = window.setInterval(refreshVisible, 60000)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('online', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [load, attempt, onSessionLost, initial])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const update = useCallback((data: T) => setResult({ state: 'ready', data }), [])
  return { ...result, retry, update }
}
