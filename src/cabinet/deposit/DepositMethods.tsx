import { useEffect, useMemo, useRef, useState } from 'react'
import { AuthError } from '../../auth/api'
import type { SectionProps } from '../section-types'
import { RouteLink } from '../router'
import { MoneySoon } from '../MoneySoon'
import { DepositApi } from './api'
import type { DepositMethod } from './model'
import './deposit.css'
import './forms.css'
import { DepositFormsApi } from './forms-api'
import { DepositForm } from './DepositForm'
import { CurrencyIcon } from './CurrencyIcon'

export interface DepositReader {
  methods(signal: AbortSignal): Promise<DepositMethod[]>
}
export function DepositSection({ session, onSessionLost }: SectionProps) {
  const reader = useMemo(() => new DepositApi(session), [session])
  const forms = useMemo(() => new DepositFormsApi(session), [session])
  const [selected, setSelected] = useState<DepositMethod | undefined>(undefined)
  if (selected?.kind)
    return (
      <DepositForm
        kind={selected.kind}
        methodKey={selected.key}
        reader={forms}
        onBack={() => setSelected(undefined)}
        onSessionLost={onSessionLost}
      />
    )
  return (
    <DepositMethods
      reader={reader}
      onSessionLost={onSessionLost}
      onChoose={setSelected}
    />
  )
}
export function DepositMethods({
  reader,
  onSessionLost,
  onChoose,
}: {
  reader: DepositReader
  onSessionLost: () => void
  onChoose?: (method: DepositMethod) => void
}) {
  const [state, setState] = useState<{
    kind: 'loading' | 'error' | 'ready'
    methods: DepositMethod[]
  }>({ kind: 'loading', methods: [] })
  const [attempt, setAttempt] = useState(0)
  const lost = useRef(onSessionLost)
  useEffect(() => {
    lost.current = onSessionLost
  }, [onSessionLost])
  useEffect(() => {
    const controller = new AbortController()
    reader
      .methods(controller.signal)
      .then((methods) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', methods })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof AuthError && error.code === 'SESSION_EXPIRED')
          lost.current()
        else setState({ kind: 'error', methods: [] })
      })
    return () => controller.abort()
  }, [reader, attempt])
  function retry() {
    setState({ kind: 'loading', methods: [] })
    setAttempt((value) => value + 1)
  }
  return (
    <main className="deposit-page deposit-v2">
      <div className="deposit-column">
        <RouteLink
          href="/cabinet"
          className="deposit-back"
          aria-label="Назад в кабинет"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 5-7 7 7 7M5 12h14" />
          </svg>
        </RouteLink>
        <h1>Пополнить счёт</h1>
        {state.kind === 'loading' ? (
          <>
            <p className="deposit-group" role="status">
              Загружаем способы пополнения…
            </p>
            <div className="deposit-list" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <div className="deposit-skeleton" key={i}>
                  <span className="deposit-bone circle" />
                  <span className="deposit-bones">
                    <span className="deposit-bone title" />
                    <span className="deposit-bone line" />
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : state.kind === 'error' ? (
          <section className="deposit-state" role="alert">
            <span className="deposit-state-icon danger" aria-hidden="true">
              !
            </span>
            <h2>Не удалось загрузить способы</h2>
            <p>Попробуйте ещё раз.</p>
            <button className="deposit-primary" onClick={retry}>
              Повторить
            </button>
          </section>
        ) : !state.methods.length ? (
          <section className="deposit-state">
            <span className="deposit-state-icon" aria-hidden="true">
              —
            </span>
            <h2>Нет доступных способов</h2>
            <p>Сейчас нет способов пополнения для вашего счёта.</p>
            <RouteLink className="deposit-primary" href="/cabinet">
              Назад
            </RouteLink>
          </section>
        ) : (
          <>
            <h2 className="deposit-group">Выберите способ пополнения</h2>
            <div className="deposit-list">
              {state.methods.map((method) => {
                const content = (
                  <>
                    <span className="deposit-icon" aria-hidden="true">
                      {method.icon === 'card' ? (
                        <svg viewBox="0 0 24 24">
                          <rect x="3" y="5" width="18" height="14" rx="3" />
                          <path d="M3 10h18M7 15h3" />
                        </svg>
                      ) : method.crypto ? (
                        <CurrencyIcon code="BTC" />
                      ) : (
                        method.name.slice(0, 1)
                      )}
                    </span>
                    <span className="deposit-copy">
                      <span className="deposit-name">{method.name}</span>
                      {!method.available && (
                        <span className="deposit-description">
                          Недоступно для вашего аккаунта
                        </span>
                      )}
                    </span>
                  </>
                )
                return method.available && method.kind && onChoose ? (
                  <button
                    key={method.key}
                    type="button"
                    className="deposit-method"
                    onClick={() => onChoose(method)}
                  >
                    {content}
                  </button>
                ) : method.available ? (
                  <MoneySoon
                    key={method.key}
                    className="deposit-method"
                    label={method.name}
                  >
                    {content}
                  </MoneySoon>
                ) : (
                  <button
                    key={method.key}
                    type="button"
                    className="deposit-method"
                    disabled
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
