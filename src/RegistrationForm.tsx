import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CabinetApi } from './auth/api'
import { session as browserSession } from './auth/browser-session'
import { Registration, passwordRules, validation } from './auth/registration'
import type { Country } from './auth/registration'
import { CountryPicker } from './CountryPicker'
import { BackIcon, ErrorIcon } from './FormIcons'

const rules = ['Не короче 10 символов', 'Строчная латинская буква', 'Заглавная латинская буква', 'Цифра']
const ruleCheck = <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg>

export function RegistrationForm({ onLogin, onSuccess, create = () => new Registration(new CabinetApi(), operation => browserSession.register(operation)) }: {
  onLogin: (email: string) => void; onSuccess: () => void; create?: () => Registration
}) {
  const [flow] = useState(create)
  const [state, setState] = useState(flow.state)
  const [countries, setCountries] = useState<Country[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [corporate, setCorporate] = useState(false)
  const [country, setCountry] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [focused, setFocused] = useState(false)
  const [serverPasswordError, setServerPasswordError] = useState(false)
  const [touched, setTouched] = useState({ country: false, email: false, password: false })
  const heading = useRef<HTMLHeadingElement>(null)
  const active = useRef(true)
  const busy = state === 'r4'
  const input = { country, email, password, corporate }
  const errors = validation(input, countries)
  const ready = !loading && !loadError && !corporate && !!country && !!email.trim() && !!password
  async function load() {
    setLoading(true); setLoadError(false)
    try { const values = await flow.configuration(); if (active.current) setCountries(values) }
    catch { if (active.current) setLoadError(true) }
    finally { if (active.current) setLoading(false) }
  }
  useEffect(() => {
    active.current = true
    void flow.configuration().then(values => { if (active.current) setCountries(values) }).catch(() => { if (active.current) setLoadError(true) }).finally(() => { if (active.current) setLoading(false) })
    return () => { active.current = false; queueMicrotask(() => { if (!active.current) void flow.dispose() }) }
  }, [flow])
  useEffect(() => { if (state === 'r7' || state === 'r9b') heading.current?.focus() }, [state])
  useEffect(() => {
    if (state !== 'r9b') return
    const timer = window.setTimeout(onSuccess, 700)
    return () => clearTimeout(timer)
  }, [state, onSuccess])
  function login() { if (!busy) { setPassword(''); void flow.dispose(); onLogin(email.trim()) } }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || flow.state === 'r4') return
    setTouched({ country: true, email: true, password: true })
    const pending = flow.submit(input)
    setState(flow.state)
    await pending
    if (active.current) { setState(flow.state); setServerPasswordError(flow.passwordError); if (['r7', 'r9b'].includes(flow.state)) setPassword('') }
  }
  if (state === 'r7' || state === 'r9b') return <section key={state} className="form registration-form step-enter">
    {state === 'r7' && <button className="back" aria-label="Назад ко входу" onClick={login}><BackIcon /></button>}
    <div className="registration-done" role="status">
      <span className={'done-icon' + (state === 'r7' ? ' warning' : '')} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{state === 'r7' ? <><circle cx="14" cy="14" r="10" /><path d="M14 8v6l4 2" /></> : <path d="m6 14 5 5 11-11" />}</svg></span>
      <h1 ref={heading} tabIndex={-1}>{state === 'r7' ? 'Регистрация не завершена' : 'Аккаунт создан'}</h1>
      <p>{state === 'r7' ? 'Аккаунт мог быть создан, но сервер не подтвердил все шаги. Попробуйте войти с этим email и паролем.' : 'Открываем личный кабинет…'}</p>
      {state === 'r7' && <span className="email-chip">{email}</span>}
    </div>
    {state === 'r7' && <p className="registration-note"><strong>Не регистрируйтесь повторно</strong>Если сервер требует дополнительные данные или войти не получится, обратитесь в поддержку [контакт компании].</p>}
    <div className="actions"><button className="primary" disabled={state === 'r9b'} onClick={login}>{state === 'r7' ? 'Перейти ко входу' : <><span className="spinner" />Открываем кабинет</>}</button></div>
  </section>
  const emailError = state === 'r5' ? 'Этот email уже зарегистрирован.' : touched.email ? errors.email : ''
  const passwordError = serverPasswordError ? 'Сервер отклонил длину пароля' : touched.password ? errors.password : ''
  return <form className="form registration-form step-enter" noValidate onSubmit={event => void submit(event)} aria-busy={busy}>
    <button type="button" className="back" aria-label="Назад ко входу" onClick={login} disabled={busy}><BackIcon /></button>
    <div className="heading"><h1 ref={heading} tabIndex={-1}>Создайте аккаунт</h1><p>Доступ к личному кабинету</p></div>
    <div className="fields registration-fields">
      <div className="client-types" data-corporate={corporate} aria-disabled={busy} role="group" aria-label="Тип клиента">{['Персональный', 'Корпоративный'].map((text, i) => <button key={text} type="button" disabled={busy} aria-pressed={corporate === !!i} onClick={() => setCorporate(!!i)}>{text}</button>)}</div>
      <div className="field-group">
        <CountryPicker countries={countries} value={country} disabled={busy || loading || loadError} loading={loading} invalid={touched.country && !!errors.country} describedBy={loadError ? 'country-load-error' : touched.country && errors.country ? 'country-error' : undefined} onBlur={() => setTouched(t => ({ ...t, country: true }))} onChange={setCountry} />
        {loadError ? <div id="country-load-error" className="field-error" role="alert"><ErrorIcon /><span>Не удалось загрузить страны и тип клиента. <button className="inline-link" type="button" onClick={() => void load()}>Повторить загрузку</button></span></div> : touched.country && errors.country && <p id="country-error" className="field-error"><ErrorIcon /><span>{errors.country}</span></p>}
      </div>
      <div className="field-group"><label htmlFor="registration-email">Email</label><input id="registration-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" value={email} disabled={busy} aria-invalid={!!emailError} aria-describedby={emailError ? 'email-error' : undefined} onBlur={() => setTouched(t => ({ ...t, email: true }))} onChange={event => { setEmail(event.target.value); if (state === 'r5') setState('r1') }} />{emailError && <p id="email-error" className="field-error"><ErrorIcon /><span>{emailError} {state === 'r5' && <><button className="inline-link" type="button" onClick={login}>Войти с ним</button> или укажите другой адрес.</>}</span></p>}</div>
      <div className="field-group"><label htmlFor="registration-password">Пароль</label><div className="password"><input id="registration-password" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="Придумайте пароль" value={password} disabled={busy} aria-invalid={!!passwordError} aria-describedby="password-help" onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setTouched(t => ({ ...t, password: true })) }} onChange={event => { setPassword(event.target.value); setServerPasswordError(false) }} /><button type="button" className="reveal" disabled={busy} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible} onClick={() => setVisible(!visible)}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Z" /><circle cx="10" cy="10" r="2.5" />{visible && <path d="m2 2 16 16" />}</svg></button></div>
        <div id="password-help" hidden={!focused && !passwordError}>{passwordError && <p className="field-error"><ErrorIcon /><span>{passwordError}</span></p>}{(focused || !!passwordError) && <ul className="password-rules">{rules.map((rule, i) => <li key={rule} className={passwordRules(password)[i] ? 'ok' : passwordError ? 'bad' : ''}><span className="rule-dot" aria-hidden="true">{passwordRules(password)[i] ? ruleCheck : null}</span>{rule}</li>)}</ul>}</div>
      </div>
      {state === 'r6' && <p className="message" role="alert"><strong>Не удалось связаться с сервером</strong>Проверьте подключение и попробуйте ещё раз.</p>}
    </div>
    <p className="legal">Создавая аккаунт, вы принимаете <span>[Клиентское соглашение]</span>, <span>[Условия учётной записи]</span> и <span>[Политику конфиденциальности]</span> [компании].</p>
    <div className="actions"><button type="submit" className="primary" disabled={!ready || busy}>{busy ? <><span className="spinner" />Создаём аккаунт…</> : state === 'r6' ? 'Повторить' : 'Создать аккаунт'}</button>{!busy && <button type="button" className="inline-link" onClick={login}>У меня уже есть аккаунт</button>}</div>
  </form>
}
