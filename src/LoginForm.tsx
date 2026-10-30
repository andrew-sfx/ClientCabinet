import { Fragment, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AuthError, FactorRequired, errorMessage } from './auth/api'
import type { CodeDelivery } from './auth/api'
import { session as browserSession } from './auth/browser-session'
import type { Session } from './auth/session'
import { BackIcon, ErrorIcon, MethodIcon } from './FormIcons'

const methodLabel: Record<string, string> = { Sms: 'Код по SMS', Email: 'Код на e-mail', GoogleAuthenticator: 'Приложение-аутентификатор' }

export function LoginForm({ onSuccess, notice, session = browserSession, initialIdentifier = '', onRegister }: { onSuccess: () => void; notice: string; session?: Session; initialIdentifier?: string; onRegister?: () => void }) {
  const [step, setStep] = useState<'identifier' | 'password' | 'code'>('identifier')
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errorKind, setErrorKind] = useState<'general' | 'credentials' | 'locked'>('general')
  const [restart, setRestart] = useState(false)
  const [visible, setVisible] = useState(false)
  const [methods, setMethods] = useState<string[]>([])
  const [method, setMethod] = useState('')
  const [delivery, setDelivery] = useState<CodeDelivery>()
  const deliveries = useRef(new Map<string, CodeDelivery>())
  const [code, setCode] = useState('')
  const [activeDigit, setActiveDigit] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const password = useRef<HTMLInputElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const revision = useRef(0)
  useEffect(() => () => { revision.current++; session.cancelLogin() }, [session])
  useEffect(() => { (step === 'password' ? password.current : heading.current)?.focus() }, [step])
  useEffect(() => { if (step === 'code' && !busy) codeInput.current?.focus() }, [step, busy, method])
  useEffect(() => {
    if (step !== 'code') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [step])
  function back() {
    revision.current++; session.cancelLogin(); setBusy(false); setMessage(''); setErrorKind('general'); setRestart(false)
    setCode(''); setActiveDigit(0); setDelivery(undefined); deliveries.current.clear(); setVisible(false)
    setStep('identifier')
  }
  function failure(error: unknown) {
    setMessage(errorMessage(error))
    setErrorKind(error instanceof AuthError && ['TOO_MANY_LOGIN_ATTEMPTS', 'TOO_MANY_ATTEMPTS', 'USER_LOCKED_OUT', 'RATE_LIMIT'].includes(error.code) ? 'locked'
      : error instanceof AuthError && ['VERIFICATION_CODE_INVALID', 'CREDENTIALS_INVALID', 'USER_NOT_FOUND', 'IDENTITY_NOT_FOUND'].includes(error.code) ? 'credentials' : 'general')
    if (error instanceof AuthError && ['MULTI_FACTOR_STATE_EXPIRED', 'SESSION_EXPIRED', 'PASSWORD_NOT_VERIFIED'].includes(error.code)) setRestart(true)
  }
  async function choose(type: string, current = revision.current, resend = false) {
    setMethod(type); setCode(''); setActiveDigit(0); setMessage(''); setErrorKind('general'); setDelivery(deliveries.current.get(type))
    if (type === 'GoogleAuthenticator') { setDelivery(undefined); return }
    const old = deliveries.current.get(type)
    if (!resend && old && old.expiresAt > Date.now()) return
    setBusy(true)
    try {
      const next = await session.sendCode(type)
      if (current === revision.current) { deliveries.current.set(type, next); setDelivery(next); setNow(Date.now()) }
    } catch (error) { if (current === revision.current) failure(error) }
    finally { if (current === revision.current) setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || restart || errorKind === 'locked') return
    setMessage(''); setErrorKind('general')
    if (step === 'identifier') {
      const value = identifier.trim()
      if (!value) { setMessage('Введите email или телефон.'); return }
      setIdentifier(value); setStep('password'); return
    }
    const current = revision.current
    setBusy(true)
    try {
      if (step === 'password') await session.login(identifier, password.current?.value ?? '')
      else await session.verifyCode(method, code)
      if (current === revision.current) onSuccess()
    } catch (error) {
      if (current !== revision.current) return
      if (error instanceof FactorRequired) {
        deliveries.current.clear(); setDelivery(undefined); setMethods(error.challenge.types); setStep('code')
        await choose(error.challenge.types[0], current)
      } else failure(error)
    } finally {
      if (password.current) password.current.value = ''
      if (current === revision.current) { setBusy(false); setCode(''); setActiveDigit(0) }
    }
  }
  const seconds = delivery ? Math.max(0, Math.ceil((delivery.resendAt - now) / 1000)) : 0
  const expired = !!delivery && delivery.expiresAt <= now
  const canVerify = method === 'GoogleAuthenticator' ? code.length > 0 : !!delivery && !expired && code.length === delivery.length
  const passwordError = step === 'password' && errorKind === 'credentials' && !!message
  const locked = errorKind === 'locked' && !!message
  return <form key={step} className="form login-form step-enter" onSubmit={event => void submit(event)} aria-busy={busy}>
    {step !== 'identifier' && <button type="button" className="back" aria-label="Назад" onClick={back} disabled={busy}><BackIcon /></button>}
    <div className="heading">
      <h1 ref={heading} tabIndex={-1}>{step === 'identifier' ? 'Вход в кабинет' : step === 'password' ? 'Введите пароль' : 'Подтвердите вход'}</h1>
      <p>{step === 'identifier' ? 'Email или телефон, указанный при регистрации' : step === 'password' ? 'Вход в ClientCabinet' : method === 'GoogleAuthenticator' ? 'Введите код из приложения-аутентификатора' : delivery ? `Отправили код ${method === 'Sms' ? 'по SMS' : 'на e-mail'}: ${delivery.maskedContact}` : 'Запросите код подтверждения'}</p>
    </div>
    {step === 'identifier' && <div className="fields"><label className="sr-only" htmlFor="identifier">Email или телефон</label><input id="identifier" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder="Email или телефон" aria-describedby={message ? 'message' : undefined} /></div>}
    {step === 'password' && <div className="fields">
      <div className="identity"><span className="avatar" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="10" cy="6.5" r="3.5" /><path d="M3 17c1.2-3.2 4-5 7-5s5.8 1.8 7 5" /></svg></span><span className="identifier" title={identifier}>{identifier}</span><button type="button" className="text-button" onClick={back} disabled={busy}>Изменить</button></div>
      <input type="text" name="username" autoComplete="username" value={identifier} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
      <label className="sr-only" htmlFor="password">Пароль</label>
      <div className="password"><input id="password" ref={password} type={visible ? 'text' : 'password'} autoComplete="current-password" required disabled={busy || restart} placeholder="Пароль" aria-invalid={passwordError} aria-describedby={message ? 'message' : undefined} /><button type="button" className="reveal" onClick={() => setVisible(!visible)} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible} disabled={busy}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Z" /><circle cx="10" cy="10" r="2.5" />{visible && <path d="m2 2 16 16" />}</svg></button></div>
    </div>}
    {step === 'password' && <div className="password-feedback">
      {passwordError && <p id="message" className="field-error" role="alert"><ErrorIcon /><span>{message}</span></p>}
      <a className="inline-link forgot-password" role="link" aria-disabled="true">Забыли пароль?</a>
    </div>}
    {step === 'code' && <div className="fields">
      <label htmlFor="code" className="sr-only">Код подтверждения{delivery ? `, ${delivery.length} символов` : ''}</label>
      <div className={delivery?.length === 6 ? 'code-control segmented' : 'code-control'}>
        {delivery?.length === 6 && <div className="code-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Fragment key={index}>{index === 3 && <i />}<span data-active={index === activeDigit}>{code[index] || ''}</span></Fragment>)}</div>}
        <input id="code" ref={codeInput} onSelect={event => setActiveDigit(Math.min(5, event.currentTarget.selectionStart ?? code.length))} value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} autoComplete="one-time-code" inputMode="numeric" maxLength={delivery?.length ?? 64} required disabled={busy || restart || (method !== 'GoogleAuthenticator' && (!delivery || expired))} aria-invalid={!!message} aria-describedby={message ? 'message' : undefined} />
      </div>
      {method !== 'GoogleAuthenticator' && <div className="code-resend">{expired && <p className="caption" role="status">Срок действия кода истёк.</p>}{seconds > 0 ? <p className="caption" role="status">Отправить повторно через {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p> : <button type="button" className="text-button resend" disabled={busy || restart} onClick={() => void choose(method, revision.current, true)}>{delivery ? 'Отправить повторно' : 'Отправить код'}</button>}</div>}
      {methods.length > 1 && <div className="other-methods"><p className="caption">Другой способ</p>{methods.filter(type => type !== method).map(type => <button key={type} type="button" className="secondary" disabled={busy || restart} onClick={() => void choose(type)}><MethodIcon method={type} />{methodLabel[type]}</button>)}</div>}
    </div>}
    {locked && <div id="message" role="alert" className="login-lockout"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg><div><strong>Вход временно ограничен</strong><p>Подождите и попробуйте позже или обратитесь к администратору.</p></div></div>}
    {!passwordError && !locked && (message || (step === 'identifier' && notice)) && <p id="message" role="alert" className="message">{message || notice}</p>}
    <div className="actions">
      {restart ? <button type="button" className="primary" onClick={back}>Начать заново</button> : <button type="submit" className="primary" disabled={busy || locked || (step === 'code' && !canVerify)}>{busy ? <><span className="spinner" aria-hidden="true" />Ожидаем ответ…</> : step === 'identifier' ? 'Продолжить' : step === 'password' ? 'Войти' : 'Подтвердить'}</button>}
      {step === 'identifier' && onRegister && <p className="register-prompt">Нет аккаунта? <button type="button" className="inline-link" disabled={busy} onClick={onRegister}>Зарегистрироваться</button></p>}
    </div>
  </form>
}
