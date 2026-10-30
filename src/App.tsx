import type { SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LoginForm } from './LoginForm'
import { RegistrationForm } from './RegistrationForm'
import { AuthHeader } from './AuthHeader'
import { errorMessage } from './auth/api'
import { session } from './auth/browser-session'
import { SESSION_KEY, SESSION_EPOCH_KEY } from './auth/session'
import { navigate } from './cabinet/router'
import { CabinetShell } from './cabinet/CabinetShell'

type Screen = 'checking' | 'login' | 'register' | 'private' | 'unavailable'

export default function App() {
  const [screen, setScreenState] = useState<Screen>('checking')
  const [loginKey, setLoginKey] = useState(0)
  const [initialIdentifier, setInitialIdentifier] = useState('')
  const returnPath = useRef(window.location.pathname.startsWith('/cabinet') ? window.location.pathname + window.location.search + window.location.hash : '/cabinet')
  const setScreen = useCallback((next: SetStateAction<Screen>) => {
    if (next === 'private' && !window.location.pathname.startsWith('/cabinet')) navigate(returnPath.current, true)
    setScreenState(next)
  }, [])
  const initialRegistration = useRef(window.location.pathname === '/register')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const generation = useRef(0)
  const accountRevision = useRef<number | undefined>(undefined)
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    const revision = generation.current
    void session.check().then(ok => {
      if (active && revision === generation.current) { setScreen(ok ? 'private' : initialRegistration.current ? 'register' : 'login'); setExpiresAt(session.expiresAt) }
    }).catch(error => {
      if (active && revision === generation.current) { setScreen(session.hasSession ? 'unavailable' : 'login'); setMessage(errorMessage(error)) }
    })
    const storageChanged = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== SESSION_KEY && event.key !== SESSION_EPOCH_KEY)) return
      // Read the current value, never the event payload: queued events can be stale.
      const revision = ++generation.current
      setLoginKey(revision)
      session.sync()
      if (!session.hasSession) {
        setScreen('login'); setBusy(false); setMessage('Сессия завершена. Войдите снова.')
        return
      }
      const sameAccount = accountRevision.current === session.accountRevision
      setScreen(current => current === 'private' && sameAccount ? current : 'checking'); setMessage('')
      void session.check().then(ok => {
        if (active && revision === generation.current) { setScreen(ok ? 'private' : 'login'); setExpiresAt(session.expiresAt); setBusy(false) }
      }).catch(error => {
        if (active && revision === generation.current) { setScreen(session.hasSession ? 'unavailable' : 'login'); setMessage(errorMessage(error)); setBusy(false) }
      })
    }
    window.addEventListener('storage', storageChanged)
    return () => { active = false; window.removeEventListener('storage', storageChanged) }
  }, [setScreen])

  useEffect(() => {
    title.current?.focus()
    if (screen === 'private') accountRevision.current = session.accountRevision
    if (screen === 'private' || screen === 'login' || screen === 'register') {
      if (screen !== 'private') {
        if (window.location.pathname.startsWith('/cabinet')) returnPath.current = window.location.pathname + window.location.search + window.location.hash
        window.history.replaceState(null, '', screen === 'register' ? '/register' : '/login')
      } else if (!window.location.pathname.startsWith('/cabinet')) navigate(returnPath.current, true)
      if (screen !== 'private') document.title = screen === 'register' ? 'ClientCabinet — регистрация' : 'ClientCabinet — вход'
    }
  }, [screen])

  useEffect(() => {
    if (screen !== 'private') return
    const verify = () => {
      const revision = generation.current
      if (accountRevision.current !== session.accountRevision) setScreen('checking')
      void session.check().then(ok => {
        if (revision === generation.current) { setScreen(ok ? 'private' : 'login'); setExpiresAt(session.expiresAt) }
      }).catch(error => {
        if (revision === generation.current) { setMessage(errorMessage(error)); setScreen(session.hasSession ? 'unavailable' : 'login') }
      })
    }
    const timer = window.setTimeout(verify, Math.max(1000, Math.min(2147483647, expiresAt - Date.now() - 60000)))
    const onVisibility = () => { if (document.visibilityState === 'visible') verify() }
    window.addEventListener('pageshow', verify)
    window.addEventListener('focus', verify)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearTimeout(timer); window.removeEventListener('pageshow', verify); window.removeEventListener('focus', verify); document.removeEventListener('visibilitychange', onVisibility) }
  }, [screen, expiresAt, setScreen])

  async function retry() {
    const revision = ++generation.current
    setScreen('checking'); setMessage('')
    try {
      const ok = await session.check()
      if (revision === generation.current) { setScreen(ok ? 'private' : 'login'); setExpiresAt(session.expiresAt) }
    } catch (error) { if (revision === generation.current) { setMessage(errorMessage(error)); setScreen(session.hasSession ? 'unavailable' : 'login') } }
  }

  async function logout() {
    const revision = ++generation.current
    setBusy(true); setScreen('checking'); setMessage('Завершаем сессию…')
    const revoked = await session.logout()
    if (revision !== generation.current) return
    setBusy(false); setScreen('login')
    setMessage(revoked ? 'Вы вышли из кабинета.' : 'Вы вышли на этом устройстве. Сервер не подтвердил отзыв сессии; она может оставаться действительной до истечения срока.')
  }

  const sessionLost = useCallback(() => {
    ++generation.current
    setScreen('login'); setMessage('Сессия истекла. Войдите снова.'); setLoginKey(value => value + 1)
  }, [setScreen])

  if (screen === 'private') return <CabinetShell key={session.accountRevision} session={session} onSessionLost={sessionLost} onLogout={() => void logout()} />

  return (
    <div className={'page' + (screen === 'register' ? ' registration-page' : '')}>
      <AuthHeader />
      <main className="column" aria-busy={busy || screen === 'checking'}>
        {screen === 'login' && <LoginForm key={loginKey} notice={message} initialIdentifier={initialIdentifier} onRegister={() => { setMessage(''); setScreen('register') }} onSuccess={() => { setScreen('private'); setExpiresAt(session.expiresAt); setMessage('') }} />}
        {screen === 'register' && <RegistrationForm onLogin={email => { ++generation.current; setInitialIdentifier(email); setLoginKey(key => key + 1); setMessage(''); setScreen('login') }} onSuccess={() => { setScreen('private'); setExpiresAt(session.expiresAt); setMessage('') }} />}
        {screen === 'checking' && <div role="status" className="heading"><h1 ref={title} tabIndex={-1}>{busy ? 'Завершаем сессию' : 'Проверяем сессию'}</h1><p>{message || 'Ожидаем ответ сервера…'}</p></div>}
        {screen === 'unavailable' && <section className="form">
          <div className="heading"><h1 ref={title} tabIndex={-1}>Не удалось проверить сессию</h1><p role="alert" className="message">{message}</p></div>
          <div className="actions"><button className="primary" onClick={() => void retry()}>Повторить</button><button className="secondary" onClick={() => void logout()}>Выйти</button></div>
        </section>}
      </main>
    </div>
  )
}
