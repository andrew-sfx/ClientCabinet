import { isolateModal } from '../modal'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthError, errorMessage } from '../../auth/api'
import type { DepositKind } from './forms-api'
import { amountValue, feeDescription } from './forms-model'
import type {
  AddressResult,
  DepositData,
  Invoice,
  Selection,
  Terms,
} from './forms-model'
import { CurrencyIcon } from './CurrencyIcon'
import { downloadInvoice } from './invoice-pdf'
import './forms.css'
export interface FormsReader {
  load(
    kind: DepositKind,
    key: string,
    signal: AbortSignal,
  ): Promise<DepositData>
  terms(
    selection: Selection,
    country: DepositData['country'],
    signal: AbortSignal,
  ): Promise<Terms>
  hasUnknown(kind: DepositKind, number: string): Promise<boolean>
  createAddress(
    selection: Selection,
    signal: AbortSignal,
  ): Promise<AddressResult>
  createInvoice(
    selection: Selection,
    amount: number,
    country: NonNullable<DepositData['country']>,
    signal: AbortSignal,
  ): Promise<Invoice>
}
const number = (value: number, precision = 8) =>
  new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: Math.min(precision, 20),
  }).format(value)
const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 10 5 5 5-5" />
  </svg>
)
const Copy = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="3" />
    <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
  </svg>
)
function Primary({
  children,
  disabled = false,
  busy = false,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  busy?: boolean
  onClick?: () => void
}) {
  return (
    <div className="cta-dock">
      <button
        type="button"
        className={'primary' + (busy ? ' busy' : '')}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={onClick}
      >
        {busy && <span className="spin" aria-hidden="true" />}
        <span>{children}</span>
      </button>
    </div>
  )
}
function Frame({
  title,
  children,
  onBack,
  busy = false,
}: {
  title: string
  children: ReactNode
  onBack: () => void
  busy?: boolean
}) {
  return (
    <main className="deposit-v2">
      <div className="page">
        <div className="column">
          <button
            type="button"
            className="back"
            aria-label="Назад к способам пополнения"
            disabled={busy}
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m12 5-7 7 7 7M5 12h14" />
            </svg>
          </button>
          <div className="form-screen">
            <h1>{title}</h1>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
export function DepositForm({
  kind,
  methodKey,
  reader,
  onBack,
  onSessionLost,
}: {
  kind: DepositKind
  methodKey: string
  reader: FormsReader
  onBack: () => void
  onSessionLost: () => void
}) {
  const [load, setLoad] = useState<{ data?: DepositData; error?: string }>({}),
    [attempt, setAttempt] = useState(0)
  const lost = useRef(onSessionLost)
  useEffect(() => {
    lost.current = onSessionLost
  }, [onSessionLost])
  useEffect(() => {
    const c = new AbortController()
    reader
      .load(kind, methodKey, c.signal)
      .then((data) => {
        if (!c.signal.aborted) setLoad({ data })
      })
      .catch((error) => {
        if (c.signal.aborted) return
        if (error instanceof AuthError && error.code === 'SESSION_EXPIRED')
          lost.current()
        else
          setLoad({
            error:
              error instanceof AuthError && error.code === 'METHOD_UNAVAILABLE'
                ? 'Этот способ сейчас недоступен для вашего аккаунта.'
                : errorMessage(error),
          })
      })
    return () => c.abort()
  }, [reader, kind, methodKey, attempt])
  const title =
    kind === 'wire' ? 'Банковский перевод' : 'Пополнение криптовалютой'
  if (load.data)
    return (
      <ReadyForm
        key={attempt + ':' + kind + ':' + methodKey}
        kind={kind}
        reader={reader}
        data={load.data}
        onBack={onBack}
        onSessionLost={onSessionLost}
      />
    )
  return (
    <Frame title={title} onBack={onBack}>
      <div className="action-body">
        {load.error ? (
          <section className="state" role="alert">
            <h2>Не удалось загрузить форму</h2>
            <p>{load.error}</p>
          </section>
        ) : (
          <>
            <p role="status" className="loading-label">
              Загружаем данные для пополнения…
            </p>
            <div className="form" aria-hidden="true">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          </>
        )}
      </div>
      {load.error && (
        <Primary
          onClick={() => {
            setLoad({})
            setAttempt((v) => v + 1)
          }}
        >
          Повторить
        </Primary>
      )}
    </Frame>
  )
}
type Option = { key: string; title: string; subtitle?: string; code: string }
function Picker({
  title,
  options,
  value,
  onSelect,
  onClose,
  returnTo,
}: {
  title: string
  options: Option[]
  value: string
  onSelect: (key: string) => void
  onClose: () => void
  returnTo: HTMLElement | null
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    root = useRef<HTMLDivElement>(null),
    id = useId()
  useEffect(() => {
    heading.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab') {
        const buttons = [
            ...root.current!.querySelectorAll<HTMLButtonElement>('button'),
          ],
          first = buttons[0],
          last = buttons.at(-1)!
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    const restoreBackground = isolateModal(root.current!)
    return () => {
      restoreBackground()
      document.removeEventListener('keydown', key)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [onClose, returnTo])
  return (
    <div
      className="modal-backdrop"
      ref={root}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="modal-header">
          <h2 ref={heading} id={id} tabIndex={-1}>
            {title}
          </h2>
          <button
            className="close"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-group" role="listbox" aria-label={title}>
          {options.map((option) => (
            <button
              type="button"
              key={option.key}
              className="modal-row"
              role="option"
              aria-selected={option.key === value}
              onClick={() => onSelect(option.key)}
            >
              <CurrencyIcon
                code={option.code}
                selected={option.key === value}
              />
              <span className="grow">
                <span className="row-title">{option.title}</span>
                {option.subtitle && (
                  <span className="row-subtitle">{option.subtitle}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        {!options.length && <p className="notice">Нет доступных вариантов.</p>}
      </section>
    </div>
  )
}
function ReadyForm({
  kind,
  data,
  reader,
  onBack,
  onSessionLost,
}: {
  kind: DepositKind
  data: DepositData
  reader: FormsReader
  onBack: () => void
  onSessionLost: () => void
}) {
  const [accountKey, setAccount] = useState(''),
    [currencyCode, setCurrency] = useState(''),
    [networkKey, setNetwork] = useState(''),
    [amount, setAmount] = useState(''),
    [touched, setTouched] = useState(false),
    [agree, setAgree] = useState(false)
  const [quote, setQuote] = useState<{
      key: string
      data?: Terms
      error?: string
      unknown?: boolean
    }>({ key: '' }),
    [retry, setRetry] = useState(0),
    [modal, setModal] = useState<'account' | 'currency' | 'network' | null>(
      null,
    ),
    [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const [operation, setOperation] = useState<{
    kind: 'idle' | 'pending' | 'unknown' | 'error' | 'success'
    message?: string
    address?: AddressResult
    invoice?: Invoice
  }>({ kind: 'idle' })
  const [notice, setNotice] = useState(''),
    [pdfBusy, setPdfBusy] = useState(false),
    lifetime = useRef<AbortController | null>(null),
    inFlight = useRef(false)
  useEffect(() => {
    const c = new AbortController()
    lifetime.current = c
    return () => c.abort()
  }, [])
  const account = data.accounts.find((a) => a.key === accountKey),
    currency = data.currencies.find((c) => c.code === currencyCode),
    networks = data.networks.filter((n) => n.currency.code === currencyCode),
    network = networks.find((n) => n.key === networkKey)
  const config =
    kind === 'wire'
      ? data.configs.find((c) =>
          c.currencies.some((v) => v.code === currencyCode),
        )
      : network?.config
  const context = JSON.stringify([
      accountKey,
      currencyCode,
      networkKey,
      config?.paymentTypeCode,
      retry,
    ]),
    selection =
      account && currency && config && (kind === 'wire' || network)
        ? { revision: data.revision, account, currency, config, network }
        : undefined
  const latestLost = useRef(onSessionLost)
  useEffect(() => {
    latestLost.current = onSessionLost
  }, [onSessionLost])
  useEffect(() => {
    if (!selection) return
    const c = new AbortController()
    Promise.all([
      reader.terms(selection, data.country, c.signal),
      reader.hasUnknown(kind, selection.account.number),
    ])
      .then(([terms, unknown]) => {
        if (!c.signal.aborted) setQuote({ key: context, data: terms, unknown })
      })
      .catch((error) => {
        if (c.signal.aborted) return
        if (error instanceof AuthError && error.code === 'SESSION_EXPIRED')
          latestLost.current()
        else setQuote({ key: context, error: explain(error) })
      })
    return () => c.abort()
    // Selection is represented by the stable context; amount never triggers a quote request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, context, kind, data])
  const terms = quote.key === context ? quote.data : undefined,
    quoteError = quote.key === context ? quote.error : undefined,
    unknown =
      operation.kind === 'unknown' || (quote.key === context && quote.unknown),
    busy = operation.kind === 'pending',
    blocked = busy || !!unknown
  const conversion = !!(
    account?.currency &&
    currency &&
    account.currency.code !== currency.code
  )
  let amountError = ''
  if (kind === 'wire' && terms && currency) {
    try {
      amountValue(amount, currency, terms)
    } catch (error) {
      amountError = amountMessage(error, terms, currency.code)
    }
  }
  const missingCountry = kind === 'wire' && !data.country
  const canSubmit =
    !!selection &&
    !!terms &&
    !quoteError &&
    !blocked &&
    !missingCountry &&
    (kind === 'crypto' || (!amountError && (!conversion || agree)))
  function select(type: typeof modal, key: string) {
    if (blocked) return
    if (type === 'account') setAccount(key)
    if (type === 'currency') {
      setCurrency(key)
      setAmount('')
      setTouched(false)
      const ns = data.networks.filter((n) => n.currency.code === key)
      setNetwork(ns.length === 1 ? ns[0].key : '')
    }
    if (type === 'network') setNetwork(key)
    setAgree(false)
    setOperation({ kind: 'idle' })
    setModal(null)
  }
  async function submit() {
    if (
      inFlight.current ||
      !canSubmit ||
      !selection ||
      !terms ||
      !lifetime.current
    )
      return
    inFlight.current = true
    setOperation({ kind: 'pending' })
    const signal = lifetime.current.signal
    try {
      const result =
        kind === 'crypto'
          ? { address: await reader.createAddress(selection, signal) }
          : {
              invoice: await reader.createInvoice(
                selection,
                amountValue(amount, selection.currency, terms),
                data.country!,
                signal,
              ),
            }
      if (!signal.aborted) setOperation({ kind: 'success', ...result })
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof AuthError && error.code === 'SESSION_EXPIRED') {
        latestLost.current()
        return
      }
      setOperation(
        error instanceof AuthError && error.code === 'OPERATION_UNKNOWN'
          ? { kind: 'unknown' }
          : { kind: 'error', message: explain(error) },
      )
    } finally {
      inFlight.current = false
    }
  }
  const open = (
    type: NonNullable<typeof modal>,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setTrigger(e.currentTarget)
    setModal(type)
  }
  const accountLabel = account
    ? account.label + (account.currency ? ' · ' + account.currency.code : '')
    : 'Выберите счёт'
  const accountControl = (
    <button
      type="button"
      className="account-chip"
      data-picker="account"
      disabled={blocked}
      onClick={(e) => open('account', e)}
      aria-label={'На счёт: ' + accountLabel}
    >
      {account && (
        <CurrencyIcon code={account.currency?.code ?? currency?.code ?? '—'} />
      )}
      <span>{accountLabel}</span>
      <Chevron />
    </button>
  )
  const closePicker = useCallback(() => setModal(null), [])
  const options: Option[] =
    modal === 'account'
      ? data.accounts.map((a) => ({
          key: a.key,
          title: a.label + (a.currency ? ' · ' + a.currency.code : ''),
          subtitle:
            a.available !== undefined && a.currency
              ? number(a.available, a.currency.precision) +
                ' ' +
                a.currency.code
              : undefined,
          code: a.currency?.code ?? currency?.code ?? '—',
        }))
      : modal === 'currency'
        ? data.currencies.map((c) => ({
            key: c.code,
            title: c.name,
            subtitle: c.code,
            code: c.code,
          }))
        : networks.map((n) => ({
            key: n.key,
            title: n.label,
            subtitle: n.currency.code,
            code:
              n.config.paymentTypeCode === 'Ethereum' ? 'ETH' : currencyCode,
          }))
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Скопировано')
    } catch {
      setNotice('Не удалось скопировать. Выделите значение вручную.')
    }
  }
  const title =
    kind === 'wire' ? 'Банковский перевод' : 'Пополнение криптовалютой'
  if (operation.kind === 'success')
    return (
      <Frame
        title={
          operation.invoice
            ? 'Реквизиты перевода'
            : currency
              ? 'Пополнение в ' + currency.code
              : title
        }
        onBack={onBack}
      >
        <div className="action-body">
          <div className="result">
            {operation.address && (
              <>
                <div className="result-header">
                  <CurrencyIcon code={currencyCode} />
                  <div>
                    <h2>{currencyCode}</h2>
                    <p>Сеть: {network?.label}</p>
                  </div>
                </div>
                <p className="notice">
                  Отправьте желаемую сумму на указанный адрес.
                </p>
                {[
                  {
                    label: 'Адрес для пополнения',
                    value: operation.address.value,
                  },
                  ...(operation.address.tag
                    ? [{ label: 'Тег платежа', value: operation.address.tag }]
                    : []),
                ].map((row) => (
                  <div className="address" key={row.label}>
                    <div className="address-row">
                      <span className="grow">
                        <span className="caption">{row.label}</span>
                        <span className="address-value">{row.value}</span>
                      </span>
                      <button
                        className="copy"
                        type="button"
                        aria-label={'Копировать: ' + row.label}
                        onClick={() => void copy(row.value)}
                      >
                        <Copy />
                      </button>
                    </div>
                  </div>
                ))}
                <p className="notice">
                  Сеть отправки должна совпадать с выбранной сетью пополнения.
                </p>
              </>
            )}
            {operation.invoice && (
              <>
                <p className="notice">
                  Используйте данные инвойса для банковского перевода.
                </p>
                <div className="quiet">
                  <div className="kv">
                    <span>Сумма</span>
                    <b>
                      {operation.invoice.amount} {operation.invoice.currency}
                    </b>
                  </div>
                  <div className="kv">
                    <span>На счёт</span>
                    <b>{accountLabel}</b>
                  </div>
                </div>
                {[operation.invoice.header, ...operation.invoice.groups]
                  .filter((group) => group.length)
                  .map((group, i) => (
                    <div className="quiet" key={i}>
                      {group.map((row, j) => (
                        <div className="kv" key={j}>
                          <span>{row.key}</span>
                          <b>{row.value}</b>
                        </div>
                      ))}
                    </div>
                  ))}
                <button
                  className="secondary"
                  type="button"
                  disabled={pdfBusy}
                  onClick={async () => {
                    if (pdfBusy) return
                    setPdfBusy(true)
                    try {
                      await downloadInvoice(operation.invoice!, accountLabel)
                    } catch {
                      setNotice(
                        'Не удалось создать PDF. Попробуйте скачать документ ещё раз.',
                      )
                    } finally {
                      setPdfBusy(false)
                    }
                  }}
                >
                  {pdfBusy ? 'Готовим PDF…' : 'Скачать PDF'}
                </button>
              </>
            )}
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
          </div>
        </div>
        <Primary onClick={onBack}>Готово</Primary>
      </Frame>
    )
  return (
    <Frame title={title} onBack={onBack} busy={busy}>
      <div className={'action-body' + (kind === 'wire' ? ' bank-body' : '')}>
        <p className="intro">
          {kind === 'wire'
            ? 'Укажите счёт, валюту и сумму пополнения.'
            : 'Выберите валюту и сеть для пополнения.'}
        </p>
        {kind === 'wire' ? (
          <div className="money-editor">
            <div
              className={
                'amount-entry' + (touched && amountError ? ' invalid' : '')
              }
            >
              <input
                id="deposit-amount"
                style={{ width: Math.max(1, amount.length) + 'ch' }}
                aria-label="Сумма пополнения"
                aria-invalid={!!(touched && amountError)}
                aria-describedby={
                  touched && amountError ? 'deposit-amount-error' : undefined
                }
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                disabled={blocked}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setOperation({ kind: 'idle' })
                }}
                onBlur={() => setTouched(true)}
              />
              <span className="amount-symbol" aria-hidden="true">
                {(
                  {
                    USD: '$',
                    EUR: '€',
                    GBP: '£',
                    CHF: 'CHF',
                    AUD: 'A$',
                  } as Record<string, string>
                )[currencyCode] ?? ''}
              </span>
              <button
                className="currency-pill"
                type="button"
                data-picker="currency"
                onClick={(e) => open('currency', e)}
                disabled={blocked}
                aria-label={
                  'Валюта пополнения: ' + (currencyCode || 'выберите')
                }
              >
                {currency && <CurrencyIcon code={currencyCode} />}
                <span>{currencyCode || 'Валюта'}</span>
                <Chevron />
              </button>
            </div>
            {touched && amountError && (
              <p id="deposit-amount-error" className="validation">
                {amountError}
              </p>
            )}
            {accountControl}
          </div>
        ) : (
          <>
            <div className="crypto-hero">
              <span className="chip-label">Валюта пополнения</span>
              <button
                className="crypto-currency"
                type="button"
                data-picker="currency"
                disabled={blocked}
                onClick={(e) => open('currency', e)}
              >
                {currency && <CurrencyIcon code={currencyCode} />}
                <span>{currencyCode || 'Выберите валюту'}</span>
                <Chevron />
              </button>
              <div className="crypto-network">
                <span className="chip-label">Сеть</span>
                <button
                  className="network-chip"
                  type="button"
                  data-picker="network"
                  disabled={blocked || !currency || networks.length < 2}
                  onClick={(e) => open('network', e)}
                >
                  <span>{network?.label ?? 'Выберите сеть'}</span>
                  <Chevron />
                </button>
              </div>
            </div>
            <div className="crypto-account">{accountControl}</div>
          </>
        )}
        <div className="summary">
          <div>
            <span>Баланс</span>
            <b>
              {terms?.available !== undefined
                ? number(terms.available) + ' ' + terms.balanceCurrency
                : '—'}
            </b>
          </div>
          <div>
            <span>Комиссия</span>
            <b>
              {terms?.fee
                ? feeDescription(
                    terms.fee,
                    kind === 'wire' && !amountError
                      ? Number(amount.replaceAll(/\s/g, '').replace(',', '.'))
                      : undefined,
                  )
                : '—'}
            </b>
          </div>
          {kind === 'crypto' && (
            <>
              <div>
                <span>Мин. подтверждений</span>
                <b>{network?.config.confirmations ?? '—'}</b>
              </div>
              <div>
                <span>Мин. депозит</span>
                <b>
                  {terms && currency
                    ? number(terms.min, currency.precision) +
                      ' ' +
                      currency.code
                    : '—'}
                </b>
              </div>
            </>
          )}
          {kind === 'wire' && terms && currency && (
            <div>
              <span>Допустимая сумма</span>
              <b>
                {number(terms.min, currency.precision)} —{' '}
                {number(terms.max, currency.precision)} {currency.code}
              </b>
            </div>
          )}
        </div>
        {selection && !terms && !quoteError && (
          <p role="status" className="hint">
            Проверяем условия пополнения…
          </p>
        )}
        {terms?.rate && currency && account?.currency && (
          <label className="conversion">
            <input
              type="checkbox"
              checked={agree}
              disabled={blocked}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>
              Согласен с конвертацией по курсу 1 {currency.code} ≈{' '}
              {number(terms.rate)} {account.currency.code}. Курс может
              измениться.
            </span>
          </label>
        )}
        {missingCountry && (
          <p role="alert" className="form-error">
            Для банковского перевода нужна страна проживания в профиле.
            Обратитесь в поддержку.
          </p>
        )}
        {quoteError && (
          <div className="form-error" role="alert">
            <p>{quoteError}</p>
            <button
              type="button"
              className="secondary"
              disabled={blocked}
              onClick={() => setRetry((v) => v + 1)}
            >
              Повторить проверку условий
            </button>
          </div>
        )}
        {operation.kind === 'error' && (
          <p className="form-error" role="alert">
            {operation.message}
          </p>
        )}
        {unknown && (
          <p className="form-error" role="alert">
            Результат предыдущего запроса неизвестен. Проверьте историю операций
            или обратитесь в поддержку. Повторная отправка заблокирована.
          </p>
        )}
        {!data.currencies.length && (
          <p className="notice">
            Нет доступных валют пополнения для этого способа.
          </p>
        )}
        {kind === 'crypto' && (
          <p className="hint">
            Сеть отправки должна совпадать с выбранной сетью пополнения.
          </p>
        )}
      </div>
      <Primary disabled={!canSubmit} busy={busy} onClick={() => void submit()}>
        {busy
          ? kind === 'wire'
            ? 'Создаём инвойс…'
            : 'Получаем адрес…'
          : 'Продолжить'}
      </Primary>
      {modal && (
        <Picker
          title={
            modal === 'account'
              ? 'На счёт'
              : modal === 'network'
                ? 'Выберите сеть'
                : 'Валюта пополнения'
          }
          options={options}
          value={
            modal === 'account'
              ? accountKey
              : modal === 'currency'
                ? currencyCode
                : networkKey
          }
          onSelect={(key) => select(modal, key)}
          onClose={closePicker}
          returnTo={trigger}
        />
      )}
    </Frame>
  )
}
function amountMessage(error: unknown, terms: Terms, currency: string) {
  const code = error instanceof AuthError ? error.code : ''
  return code === 'AMOUNT_MIN'
    ? 'Минимальная сумма — ' + number(terms.min) + ' ' + currency
    : code === 'AMOUNT_MAX'
      ? 'Максимальная сумма — ' + number(terms.max) + ' ' + currency
      : code === 'AMOUNT_PRECISION'
        ? 'Слишком много знаков после запятой.'
        : 'Введите корректную сумму пополнения.'
}
function explain(error: unknown) {
  const code = error instanceof AuthError ? error.code : ''
  if (code === 'NO_BANKS_AVAILABLE')
    return 'Инвойс не создан. Сейчас нет доступных банковских реквизитов.'
  if (code === 'COUNTRY_REQUIRED')
    return 'Для банковского перевода нужна страна проживания в профиле.'
  if (code === 'PAYMENT_METHOD_UNAVAILABLE')
    return 'Выбранная сеть или валюта сейчас недоступна. Выберите другой вариант или способ пополнения.'
  if (code === 'TOKEN_UNAVAILABLE')
    return 'Эта сеть сейчас недоступна. Выберите другую сеть.'
  if (code === 'RATE_UNAVAILABLE')
    return 'Не удалось получить курс конвертации.'
  if (code === 'UNSUPPORTED_FEE')
    return 'Не удалось подтвердить комиссию для выбранной валюты.'
  return errorMessage(error)
}
