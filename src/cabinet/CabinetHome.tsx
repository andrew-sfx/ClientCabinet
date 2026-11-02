import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthError } from '../auth/api'
import { CurrencySelectionSuperseded, HomeApi, dateLabel, feeLabel, money, signedAmount } from './api'
import type { BalanceView, Operation, TradingAccount } from './api'
import { Icon } from './Icons'
import { OverlayScroll } from '../OverlayScroll'
import { useScrollCardLimit } from '../useScrollCardLimit'
import { BalanceMenu } from './BalanceMenu'
import { balanceTotal, currencyName } from './balance-options'
import type { IconName } from './Icons'
import { useAnimatedClose } from '../useAnimatedClose'
import { Soon } from './shared'
import { useOverlay } from './useOverlay'
import { SectionEntry } from './SectionEntry'
import type { SectionProps } from './section-types'
import { useResource } from './useResource'


function Skeleton({ width, height = 14, round = 8 }: { width: number | string; height?: number; round?: number }) {
  return <span className="home-skeleton" style={{ width, height, borderRadius: round }} aria-hidden="true" />
}
function SkeletonRows({ count }: { count: number }) {
  return <div className="home-list home-loading" role="status" aria-label="Загрузка данных">{Array.from({ length: count }, (_, i) => <div className="home-list-row" key={i}><Skeleton width={32} height={32} round={16} /><span className="home-row-main"><Skeleton width="75%" /><Skeleton width="50%" height={12} /></span><Skeleton width="24%" /></div>)}</div>
}
function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return <div className="home-empty"><span className="home-empty-icon"><Icon name={icon} size={22} /></span><b>{title}</b>{children}</div>
}
function Failure({ title, retry, timedOut = false }: { title: string; retry: () => void; timedOut?: boolean }) {
  return <div className="home-empty home-error" role="alert"><span className="home-empty-icon"><Icon name="cloud" size={22} /></span><b>{title}</b><span>{timedOut ? 'Время ожидания ответа сервера истекло. Попробуйте ещё раз.' : 'Проверьте подключение и попробуйте ещё раз.'}</span><button type="button" className="home-pill small" onClick={retry}><Icon name="retry" size={16} />Повторить</button></div>
}
function MoneyActions({ loading = false }: { loading?: boolean }) {
  const actions: [IconName, string, string][] = [['more', 'Ещё', 'exchange'], ['out', 'Вывести', 'withdraw'], ['send', 'Перевести', 'transfer'], ['plus', 'Пополнить', 'deposit']]
  return <div className={'home-money-actions' + (loading ? ' home-loading' : '')} aria-label={loading ? 'Загрузка действий' : 'Действия со счётом'}>
    {actions.map(([icon, label, id], i) => loading
      ? <span key={icon} className={'home-money-action action-' + icon}><Skeleton width={[36, 104, 116, 132][i]} height={36} round={20} /><span className="home-mobile-action-label"><Skeleton width={56} height={10} /></span></span>
      : <SectionEntry key={icon} id={id} money label={label} className={'home-pill home-money-action action-' + icon + (icon === 'plus' ? ' home-primary' : '')}><span className="home-action-icon"><Icon name={icon} size={18} /></span><span className="home-action-label">{label}</span></SectionEntry>)}
  </div>
}
function MainBalance({ resource, api, onSessionLost }: { resource: ReturnType<typeof useResource<BalanceView>>; api: HomeApi; onSessionLost: () => void }) {
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [rowCode, setRowCode] = useState<string>(), [menu, setMenu] = useState(false)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const alive = useRef(true), changing = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const closeMenu = useCallback(() => { setMenu(false); trigger?.focus({ preventScroll: true }) }, [trigger])
  const view = resource.state === 'ready' ? resource.data : undefined
  const row = view?.balances.find(balance => balance.currency.code === rowCode)
  const loading = resource.state === 'loading' || busy
  const selected = row?.currency ?? view?.currency
  const formatted = selected ? money(row ? balanceTotal(row) : view!.total, selected, true) : view?.balances.length === 0 ? '0' : '—'
  const [integer, fraction] = formatted.split(',')
  const amount = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = amount.current
    const number = element?.querySelector<HTMLElement>('.home-balance-number')
    if (!element || !number) return
    let active = true
    const fit = () => {
      if (!active) return
      // Measure at the normal size, then apply the fallback before paint.
      element.removeAttribute('data-compact')
      if (matchMedia('(max-width: 360px)').matches && number.getBoundingClientRect().width > element.clientWidth) element.setAttribute('data-compact', '')
    }
    // Reserve the line while the local font loads; reveal only a fitted number.
    const font = document.fonts.load('700 28px Inter', '0123456789')
    if (!document.fonts.check('700 28px Inter', '0123456789')) element.setAttribute('data-fit-pending', '')
    fit()
    const reveal = () => { if (active) { fit(); element.removeAttribute('data-fit-pending') } }
    void font.then(reveal, reveal)
    // At ≤360px the available width follows the viewport (fixed card padding).
    window.addEventListener('resize', fit)
    void document.fonts.ready.then(fit)
    document.fonts.addEventListener('loadingdone', fit)
    return () => { active = false; window.removeEventListener('resize', fit); document.fonts.removeEventListener('loadingdone', fit) }
  }, [formatted, loading])
  const warning = !row && view?.missing.length ? 'Не учтены в общем балансе: ' + view.missing.join(', ') + '. Нет курса' + (selected ? ' к ' + selected.code : '') + '.' : undefined
  async function choose(code: string) {
    if (!view || changing.current || code === view.currency?.code) return
    changing.current = true; setBusy(true); setSaveError('')
    try {
      const next = await api.selectCurrency(view.balances, code)
      if (alive.current) { resource.update(next); resource.retry() }
    } catch (error) {
      if (error instanceof CurrencySelectionSuperseded) return
      if (alive.current) {
        if (error instanceof AuthError && error.code === 'SESSION_EXPIRED') onSessionLost()
        else setSaveError('Не удалось сохранить валюту. Повторите выбор.')
      }
    }
    finally { changing.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="home-balance" aria-label="Основной счёт" aria-busy={loading}>
    <div className="home-balance-row">
      {resource.state === 'loading' ? <div className="home-bal home-loading" role="status" aria-label="Загрузка баланса"><Skeleton width={110} /><Skeleton width={220} height={44} round={10} /><Skeleton width={260} /></div>
        : <div className="home-bal"><span className="home-balance-caption home-muted">Основной счёт{row && ' · ' + (currencyName(row.currency.code) ?? row.currency.code)}{warning && !busy && <span className="home-warning" tabIndex={0} aria-label={warning} title={warning}><Icon name="warning" size={16} /></span>}</span>
          <div ref={amount} className="home-balance-amount">{busy ? <Skeleton width={220} height={44} /> : <b className="home-num"><span className="home-balance-number">{integer}<small>{fraction !== undefined && ',' + fraction}</small></span><span className="home-balance-currency"><small>{selected && ' ' + selected.code}</small>
            {!!view?.balances.length && <button ref={setTrigger} type="button" className="home-balance-trigger" aria-label="Баланс по валютам" aria-haspopup="dialog" aria-expanded={menu} onClick={() => menu ? document.querySelector('.home-balance-menu')?.dispatchEvent(new Event('overlay-close')) : setMenu(true)}><Icon name="chev" size={16} /></button>}</span></b>}
          </div>
          {selected && !busy && <div className="home-balance-meta home-num"><span>Доступно <span className="home-money">{money(row?.available ?? view!.available, selected)} {selected.code} ·</span></span><span>Заблокировано <span className="home-money">{money(row?.reserved ?? view!.reserved, selected)} {selected.code}</span></span><span tabIndex={0} aria-label="Заблокированные средства — в обработке операций" title="Заблокированные средства — в обработке операций"><Icon name="info" size={15} /></span></div>}
          {view && view.balances.length > 0 && !selected && <p className="home-muted">Валюта по умолчанию недоступна. Выберите валюту отображения.</p>}
          {menu && view && <BalanceMenu saveError={saveError} view={view} selectedCode={rowCode} busy={busy} chooseRow={code => setRowCode(code)} chooseTotal={choose} close={closeMenu} trigger={trigger} />}
        </div>}
      <MoneyActions loading={resource.state === 'loading'} />
    </div>
    {saveError && !menu && <p role="alert" className="home-error">{saveError}</p>}
    {resource.state === 'error' && <Failure title="Не удалось загрузить данные счёта" retry={resource.retry} />}
  </section>
}
function OperationIcon({ operation }: { operation: Operation }) {
  // Transfer/exchange can be either Add or Withdraw in the reference response.
  const name = operation.paymentTypeCode === 'Transfer' ? 'send' : operation.paymentTypeCode === 'Exchange' ? 'exch'
    : operation.typeCode === 'Add' ? 'in' : operation.typeCode === 'Withdraw' ? 'out'
    : operation.positive === true ? 'in' : operation.positive === false ? 'out' : 'list'
  return <Icon name={name} size={16} />
}
function Operations({ resource, selected, select }: { resource: ReturnType<typeof useResource<Operation[]>>; selected?: Operation; select: (operation: Operation, target: HTMLElement) => void }) {
  return <section className="home-operations" aria-label="Последние операции" aria-busy={resource.state === 'loading'}>
    <div className="home-block-head home-mobile"><h2>Операции</h2><Soon className="home-link">Все операции</Soon></div>
    {resource.state === 'loading' ? <SkeletonRows count={5} /> : resource.state === 'error' ? <Failure title="Не удалось загрузить операции" retry={resource.retry} /> : resource.data.length === 0 ? <Empty icon="list" title="Операций пока нет"><span>Здесь появятся пополнения, переводы и выводы.</span></Empty> : <>
      <table className="home-table"><thead><tr><th>Операция</th><th>Дата</th><th>Статус</th><th className="home-fee home-right">Комиссия</th><th className="home-right">Сумма</th></tr></thead><tbody>{resource.data.map(operation => <tr key={operation.id} className={selected?.id === operation.id ? 'selected' : ''} tabIndex={0} aria-label={`${operation.type}, ${dateLabel(operation.created)}, ${signedAmount(operation)}`} aria-expanded={selected?.id === operation.id} onClick={event => select(operation, event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(operation, event.currentTarget) } }}>
        <td><span className="home-op"><span className="home-badge"><OperationIcon operation={operation} /></span><span>{operation.type}<small className="home-desktop">{operation.method}</small><small className="home-tablet">{operation.method} · {dateLabel(operation.created)}</small><small className="home-mobile">{dateLabel(operation.created)} · {operation.method}</small></span></span></td><td className="home-date home-muted home-num">{dateLabel(operation.created)}</td><td className="home-status-cell"><span className={'home-status ' + operation.tone}>{operation.status}</span></td><td className="home-fee home-right home-muted home-num">{feeLabel(operation.fee, operation.currency)}</td><td className="home-right"><span className={'home-num ' + (operation.positive === true ? 'home-plus' : '')}>{signedAmount(operation)}</span><small className={'home-mobile home-status ' + operation.tone}>{operation.status}</small></td>
      </tr>)}</tbody></table><Soon className="home-see-all">Все операции</Soon>
    </>}
  </section>
}
function AccountsLoading() {
  return <><div className="home-accounts-loading" role="status"><span>Загружаем торговые счета…</span><span className="home-muted">Это может занять до минуты.</span></div><div aria-hidden="true"><SkeletonRows count={2} /></div></>
}
function Accounts({ resource }: { resource: ReturnType<typeof useResource<TradingAccount[]>> }) {
  return <section className="home-block home-accounts" aria-label="Торговые счета" aria-busy={resource.state === 'loading'}><div className="home-block-head"><h2>Торговые счета</h2>{resource.state === 'ready' && resource.data.length > 0 && <SectionEntry id="trading" className="home-link">Все счета</SectionEntry>}</div>
    {resource.state === 'loading' ? <AccountsLoading /> : resource.state === 'error' ? <Failure title="Счета не загрузились" retry={resource.retry} timedOut={resource.timedOut} /> : resource.data.length === 0 ? <Empty icon="accounts" title="Торговых счетов нет"><span>Откройте счёт, чтобы перевести на него средства и начать торговать.</span><SectionEntry id="trading" className="home-pill small"><Icon name="plus" size={16} />Открыть счёт</SectionEntry></Empty> : <div className="home-list">{resource.data.map(account => <div className={'home-list-row' + (account.inactive ? ' home-inactive' : '')} key={account.number}><span className="home-badge"><Icon name="accounts" /></span><span className="home-row-main"><span className="home-num">{account.number}</span><small>{[account.platform, account.product, account.leverage ? `1:${account.leverage}` : undefined].filter(Boolean).join(' · ') || '—'}{account.inactive ? ' · Неактивен' : account.readonly ? ' · Только чтение' : ''}</small></span><span className="home-account-balances home-num">{account.balances.length ? account.balances.map(b => <span key={b.currency.code}>{money(b.amount, b.currency)} {b.currency.code}</span>) : '—'}</span><Soon className="home-pill small home-trade">Торговать</Soon></div>)}</div>}
  </section>
}
function PropCard() {
  return <section className="home-block home-prop"><span className="home-prop-ring" aria-hidden="true" /><h2>Prop Trading</h2><p>Пройдите испытание и торгуйте на капитале компании. Условия — из Prop-сервиса.</p><div className="home-steps"><span className="home-chip">Испытание</span><span className="home-chip">Проверка</span><span className="home-chip">Счёт с выплатами</span></div><SectionEntry id="prop" className="home-pill small">Выбрать испытание</SectionEntry></section>
}
function OperationPanel({ operation, close, returnTo }: { operation: Operation; close: () => void; returnTo: HTMLElement | null }) {
  const { element, requestClose } = useAnimatedClose<HTMLDivElement>(close, true)
  useOverlay(requestClose, returnTo, true, element)
  useScrollCardLimit(element)
  return <div ref={element} className="home-panel" role="dialog" aria-label="Карточка операции"><div className="home-panel-head"><button type="button" className="home-icon-button solid" onClick={requestClose} aria-label="Закрыть карточку операции"><Icon name="close" size={18} /></button></div><OverlayScroll className="home-panel-scroll" viewportClassName="home-panel-body" tabIndex={0} aria-label="Детали операции"><div className="home-panel-hero"><span className="home-badge large"><OperationIcon operation={operation} /></span><span className="home-muted">{operation.type}</span><b className={'home-num ' + (operation.positive === true ? 'home-plus' : '') + (signedAmount(operation).length > 22 ? ' home-long-amount' : '')}>{signedAmount(operation)}</b><span className="home-muted home-num">{dateLabel(operation.created)}</span></div>
    <div className="home-kv"><div><span>Статус</span><span className={'home-status ' + operation.tone}>{operation.status}</span></div><div><span>Способ</span><span>{operation.method}</span></div></div>
    <div className="home-kv"><div><span>Сумма</span><span className="home-num">{money(operation.amount, operation.currency)} {operation.currency.code}</span></div><div><span>Комиссия</span><span className="home-num">{feeLabel(operation.fee, operation.currency, true)}</span></div></div>
    <div className="home-kv"><div><span>Счёт</span><span title={operation.account}>{operation.account ?? '—'}</span></div><div><span>Номер операции</span><span title={operation.id}>{operation.id}</span></div></div>
  </OverlayScroll></div>
}

export function HomeSection({ summary, api, onSessionLost, setPanel, closeMenu }: SectionProps) {
  const loadBalance = useCallback(() => api.balanceSummary(summary), [api, summary])
  const loadOperations = useCallback(() => api.operations(), [api])
  const loadTrading = useCallback(() => api.trading(summary), [api, summary])
  const balance = useResource(loadBalance, onSessionLost), operations = useResource(loadOperations, onSessionLost), accounts = useResource(loadTrading, onSessionLost)
  const [selected, setSelected] = useState<Operation>()
  const [selectedRow, setSelectedRow] = useState<HTMLElement | null>(null)
  const currentOperation = operations.state === 'ready' ? operations.data.find(operation => operation.id === selected?.id) : selected
  const closePanel = useCallback(() => setSelected(undefined), [])
  useEffect(() => {
    setPanel(currentOperation ? { content: <OperationPanel key={currentOperation.id} operation={currentOperation} close={closePanel} returnTo={selectedRow} />, close: closePanel } : null)
    return () => setPanel(null)
  }, [currentOperation, selectedRow, closePanel, setPanel])
  function select(operation: Operation, target: HTMLElement) { setSelectedRow(target); if (selected?.id === operation.id) document.querySelector('.home-panel')?.dispatchEvent(new Event('overlay-close')); else setSelected(operation); closeMenu() }
  return <><div className="home-main-block"><MainBalance resource={balance} api={api} onSessionLost={onSessionLost} /><Operations resource={operations} selected={selected} select={select} /></div><div className="home-bottom"><Accounts resource={accounts} /><PropCard /></div></>
}
