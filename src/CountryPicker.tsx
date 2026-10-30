import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { OverlayScroll } from './OverlayScroll'
import type { Country } from './auth/registration'
import { countryOptions, filterCountries, prefixLength } from './countries'
import type { CountryOption } from './countries'

function Highlight({ value, query }: { value: string; query: string }) {
  const length = prefixLength(value, query)
  return length ? <><mark>{value.slice(0, length)}</mark>{value.slice(length)}</> : value
}

function CountryDialog({ countries, value, trigger, onSelect, onClose }: {
  countries: CountryOption[]; value: string; trigger: RefObject<HTMLButtonElement | null>
  onSelect: (code: string) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(value)
  const [closing, setClosing] = useState(false)
  const closingRequested = useRef(false)
  const results = filterCountries(countries, query)
  const activeIndex = results.findIndex(country => country.code === highlighted)

  function close() {
    if (closingRequested.current) return
    closingRequested.current = true
    setClosing(true)
  }

  function select(code: string) {
    if (closingRequested.current) return
    onSelect(code)
    close()
  }

  useEffect(() => {
    const element = dialog.current!
    const returnTo = trigger.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    search.current?.focus()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      returnTo?.focus({ preventScroll: true })
    }
  }, [trigger])

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[data-active="true"]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (closingRequested.current) { event.preventDefault(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!results.length) return
      const next = activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1)
        : Math.max(0, Math.min(results.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))
      setHighlighted(results[next].code)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) select(results[activeIndex].code)
    }
  }

  return <dialog ref={dialog} className={'country-dialog' + (closing ? ' is-closing' : '')} role="dialog" aria-modal="true" aria-labelledby={id + '-title'}
    onCancel={event => { event.preventDefault(); close() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      const closeButton = event.currentTarget.querySelector<HTMLButtonElement>('button')
      if (document.activeElement === search.current) closeButton?.focus()
      else search.current?.focus()
    }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="country-picker" onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClose() }}>
      <div className="picker-head"><h2 id={id + '-title'}>Страна проживания</h2><button type="button" className="picker-close" aria-label="Закрыть" onClick={close}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg></button></div>
      <div className="country-search"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="6" /><path d="m13.5 13.5 4 4" /></svg><input ref={search} type="text" role="combobox" aria-label="Поиск страны" aria-autocomplete="list" aria-expanded="true" aria-controls={id + '-list'} aria-activedescendant={activeIndex >= 0 ? id + '-option-' + activeIndex : undefined} placeholder="Поиск страны" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setHighlighted(''); if (list.current) list.current.scrollTop = 0 }} onKeyDown={keyDown} /></div>
      <OverlayScroll viewportRef={list} className="picker-scroll" viewportClassName="picker-list" role="listbox" aria-label="Страны" id={id + '-list'} tabIndex={-1}>
        {!query.trim() && <div className="picker-group" role="presentation">Все страны</div>}
        {results.map((country, index) => <div key={country.code} id={id + '-option-' + index} className="picker-row" role="option" aria-selected={country.code === value} data-active={country.code === highlighted}
          onClick={() => select(country.code)}>
          <span className="country-badge" aria-hidden="true"><Highlight value={country.code} query={query} /></span><span className="country-name"><Highlight value={country.label} query={query} /></span>
          {country.code === value && <svg className="country-tick" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>}
        </div>)}
      </OverlayScroll>
      {!results.length && <p className="picker-empty" role="status">Страна не найдена. Проверьте написание.</p>}
    </div>
  </dialog>
}

export function CountryPicker({ countries, value, disabled, loading, invalid, describedBy, onChange, onBlur }: {
  countries: Country[]; value: string; disabled: boolean; loading: boolean; invalid: boolean; describedBy?: string
  onChange: (code: string) => void; onBlur: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useMemo(() => countryOptions(countries), [countries])
  const selected = options.find(country => country.code === value)
  const label = selected?.label || (loading ? 'Загружаем страны…' : 'Выберите страну')
  return <>
    <input type="hidden" name="country" value={value} />
    <button ref={trigger} type="button" id="country" className="country-control" aria-haspopup="listbox" aria-expanded={open} aria-label={'Страна проживания: ' + label} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} onClick={() => setOpen(true)} onBlur={() => { if (!open) onBlur() }}>
      {selected && <span className="country-badge" aria-hidden="true">{selected.code}</span>}<span className="country-text"><span className="country-caption">Страна проживания</span><span className={selected ? '' : 'country-placeholder'}>{label}</span></span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    {open && <CountryDialog countries={options} value={value} trigger={trigger} onSelect={onChange} onClose={() => { setOpen(false); onBlur() }} />}
  </>
}
