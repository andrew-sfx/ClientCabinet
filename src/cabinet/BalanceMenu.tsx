import { useEffect, useState } from 'react'
import type { BalanceView } from './api'
import { money } from './api'
import { balanceOptions, balanceTotal, currencyGroups, currencyName, excludedLabel } from './balance-options'
import { useAnimatedClose } from '../useAnimatedClose'
import { OverlayScroll } from '../OverlayScroll'
import { useScrollCardLimit } from '../useScrollCardLimit'
import { CurrencyIcon } from './CurrencyIcon'
import { useOverlay } from './useOverlay'
import { Icon } from './Icons'

export function BalanceMenu({ view, selectedCode, busy, chooseRow, chooseTotal, close, trigger, saveError }: {
  view: BalanceView; saveError?: string; selectedCode?: string; busy: boolean; chooseRow: (code?: string) => void
  chooseTotal: (code: string) => Promise<void>; close: () => void; trigger: HTMLElement | null
}) {
  const [choosingTotalCurrency, setChoosingTotalCurrency] = useState(false)
  const { element, requestClose } = useAnimatedClose<HTMLDivElement>(close)
  useScrollCardLimit(element)
  useOverlay(requestClose, trigger, true, element)
  useEffect(() => {
    const node = element.current
    node?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !node?.contains(event.target) && !trigger?.contains(event.target)) requestClose() }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); requestClose() }
      if (!node?.contains(document.activeElement)) return
      const options = [...node.querySelectorAll<HTMLElement>('[role="option"]')]
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const index = options.indexOf(document.activeElement as HTMLElement)
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
      }

    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown, true) }
  }, [requestClose, trigger, choosingTotalCurrency, view.currency?.code, element])
  const amount = (value: number) => view.currency ? `${money(value, view.currency)} ${view.currency.code}` : '—'
  return <div className="home-balance-menu" role="dialog" ref={element} aria-label="Баланс по валютам" aria-busy={busy}>
    <div className="home-balance-menu-head">{choosingTotalCurrency && <button type="button" className="home-balance-back" aria-label="Назад к балансу" onClick={() => setChoosingTotalCurrency(false)}><Icon name="right" size={16} /></button>}<h2>{choosingTotalCurrency ? 'Считать «Всего» в' : 'Основной счёт'}</h2><button type="button" className="home-balance-close home-icon-button" aria-label="Закрыть баланс" onClick={requestClose}><Icon name="close" /></button></div>
    {saveError && <p role="alert" className="home-error">{saveError}</p>}
    {choosingTotalCurrency ? <><OverlayScroll viewportClassName="home-balance-options" role="listbox" aria-label="Считать «Всего» в">{currencyGroups(view.balances).map(group => <div role="group" aria-label={group.name} key={group.name}><p className="home-balance-group">{group.name}</p>{group.balances.map(balance => <button type="button" role="option" aria-selected={balance.currency.code === view.currency?.code} aria-disabled={busy} className={'home-balance-option home-total-option' + (balanceTotal(balance) === 0 ? ' home-zero' : '')} key={balance.currency.code} onClick={() => { if (!busy) void chooseTotal(balance.currency.code).then(() => setChoosingTotalCurrency(false)) }}><CurrencyIcon code={balance.currency.code} selected={choosingTotalCurrency ? balance.currency.code === view.currency?.code : selectedCode === balance.currency.code} /><span className="home-balance-option-name">{currencyName(balance.currency.code)}</span><span className="home-num">{money(balanceTotal(balance), balance.currency)}</span></button>)}</div>)}</OverlayScroll><p className="home-balance-explanation">Общий баланс пересчитывается по курсу сервера. Валюты без курса к выбранной не войдут в сумму.</p></>
      : <><OverlayScroll viewportClassName="home-balance-options" role="listbox" aria-label="Баланс по валютам"><button type="button" role="option" aria-selected={!selectedCode} className="home-balance-option" onClick={() => { requestClose(); chooseRow() }}><CurrencyIcon selected={!selectedCode} /><span className="home-balance-option-name">Всего<small>Валют: {balanceOptions(view).length}{view.missing.length > 0 && ` · ${excludedLabel(view.missing)}`}</small></span><span className="home-balance-option-amount home-num">{amount(view.total)}{view.reserved !== 0 && <small>Заблокировано {view.currency ? money(view.reserved, view.currency) : '—'}</small>}</span></button><p className="home-balance-group">Валюты</p>{balanceOptions(view).map(balance => <button type="button" role="option" aria-selected={selectedCode === balance.currency.code} className="home-balance-option" key={balance.currency.code} onClick={() => { requestClose(); chooseRow(balance.currency.code) }}><CurrencyIcon code={balance.currency.code} selected={choosingTotalCurrency ? balance.currency.code === view.currency?.code : selectedCode === balance.currency.code} /><span className="home-balance-option-name">{currencyName(balance.currency.code)}{balance.reserved !== 0 && <small>Заблокировано {money(balance.reserved, balance.currency)}</small>}</span><span className="home-balance-option-amount home-num">{money(balanceTotal(balance), balance.currency)} {balance.currency.code}{balance.currency.code !== view.currency?.code && (view.converted[balance.currency.code] !== undefined ? <small>≈ {amount(view.converted[balance.currency.code])}</small> : <small className="home-warning">⚠ нет курса{view.currency ? ` к ${view.currency.code}` : ''}</small>)}</span></button>)}</OverlayScroll><button type="button" className="home-balance-setting" onClick={() => setChoosingTotalCurrency(true)}><span>Считать «Всего» в</span><span className="home-chip">{view.currency?.code ?? 'Валюта'}<Icon name="right" size={14} /></span></button></>}
  </div>
}
