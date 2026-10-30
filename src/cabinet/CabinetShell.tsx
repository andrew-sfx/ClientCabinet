import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useResource } from './useResource'
import type { AccountSummary } from '../auth/api'
import type { Session } from '../auth/session'
import { HomeApi, identity } from './api'
import { Icon } from './Icons'
import { OverlayScroll } from '../OverlayScroll'
import { useScrollCardLimit } from '../useScrollCardLimit'
import { useAnimatedClose } from '../useAnimatedClose'
import { useOverlay } from './useOverlay'
import { Brand, Soon } from './shared'
import { SectionEntry } from './SectionEntry'
import { SectionRegistry } from './section-context'
import { sections, resolveSection } from './sections'
import type { CabinetSection, ShellPanel } from './section-types'
import { navigate, useRoute } from './router'
import './home.css'

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return <nav aria-label={mobile ? 'Разделы кабинета, телефон' : 'Разделы кабинета'} className={mobile ? 'home-tabbar' : 'home-rail'}>
    {!mobile && <Brand />}
    <SectionEntry id="home" className="home-nav" active><span className="home-nav-icon"><Icon name="home" /></span>Главная</SectionEntry>
    <SectionEntry id="trading" className="home-nav" active><span className="home-nav-icon"><Icon name="accounts" /></span>{mobile ? 'Счета' : <>Торговые<br />счета</>}</SectionEntry>
    <SectionEntry id="prop" className="home-nav" active><span className="home-nav-icon"><Icon name="prop" /></span>{mobile ? 'Prop' : <>Prop<br />Trading</>}</SectionEntry>
  </nav>
}
function AvatarMenu({ summary, close, returnTo, logout }: { summary: AccountSummary; close: () => void; returnTo: HTMLElement | null; logout: () => void }) {
  const user = identity(summary)
  const { element, requestClose } = useAnimatedClose<HTMLDivElement>(close)
  useOverlay(requestClose, returnTo, true, element)
  useScrollCardLimit(element)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.current?.contains(event.target) && !returnTo?.contains(event.target)) requestClose() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [requestClose, returnTo, element])
  return <div className="home-user-menu" ref={element} role="dialog" aria-label="Меню пользователя"><button type="button" className="home-icon-button solid home-menu-close" onClick={requestClose} aria-label="Закрыть меню"><Icon name="close" size={18} /></button><div className="home-user-head"><span className="home-avatar large">{user.initials}</span><div><b>{user.name}</b><small>{user.email}</small></div></div>
    <OverlayScroll viewportClassName="home-user-options" tabIndex={-1} aria-label="Действия профиля"><SectionEntry id="settings" className="home-user-row"><Icon name="user" /><span>Профиль</span><Icon name="right" size={16} /></SectionEntry><SectionEntry id="settings" className="home-user-row"><Icon name="shield" /><span>Безопасность</span><Icon name="right" size={16} /></SectionEntry><div className="home-menu-divider" /><Soon className="home-user-row"><Icon name="globe" /><span>Язык</span><small>Русский</small></Soon><div className="home-menu-divider" /><button type="button" className="home-user-row danger" onClick={logout}><Icon name="logout" /><span>Выйти</span></button></OverlayScroll>
  </div>
}

export function CabinetShell({ session, onSessionLost, onLogout, api: providedApi, registry = sections }: {
  session: Session; onSessionLost: () => void; onLogout: () => void; api?: HomeApi; registry?: CabinetSection[]
}) {
  const api = useMemo(() => providedApi ?? new HomeApi(session), [providedApi, session])
  const [initialSummary] = useState(() => session.summary)
  const loadProfile = useCallback(() => api.profile(), [api])
  const profile = useResource(loadProfile, onSessionLost, initialSummary)
  const summary = profile.state === 'ready' ? profile.data : session.summary ?? {}
  const path = useRoute()
  const section = resolveSection(path, registry)
  useEffect(() => {
    if (path !== section.path) navigate(section.path, true)
    document.title = 'ClientCabinet — ' + section.title
  }, [path, section.path, section.title])
  return <SectionRegistry value={registry}>{profile.state === 'error' && <p role="alert">Не удалось обновить профиль. <button onClick={profile.retry}>Повторить</button></p>}<ShellFrame key={section.id} section={section} session={session} summary={summary} api={api} onSessionLost={onSessionLost} onLogout={onLogout} /></SectionRegistry>
}

// Changing sections resets transient overlays; API/session/summary stay in the shell.
function ShellFrame({ section, session, summary, api, onSessionLost, onLogout }: {
  section: CabinetSection; session: Session; summary: AccountSummary; api: HomeApi; onSessionLost: () => void; onLogout: () => void
}) {
  const Component = section.component!
  const [menu, setMenu] = useState(false)
  const [avatar, setAvatar] = useState<HTMLElement | null>(null)
  const [panel, setPanel] = useState<ShellPanel>(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  const user = identity(summary)
  if (section.standalone) return <Suspense fallback={null}><Component session={session} summary={summary} api={api} onSessionLost={onSessionLost} onLogout={onLogout} setPanel={setPanel} closeMenu={closeMenu} /></Suspense>
  return <div className={'home-shell' + (panel ? ' home-with-panel' : '')}><Navigation /><main className="home-main"><div className="home-content"><header className="home-topbar"><div className="home-mobile"><Brand /></div><h1>{section.title}</h1><div className={'home-user' + (menu ? ' open' : '')}><Soon className="home-icon-button" label="Уведомления"><Icon name="bell" /></Soon><button type="button" className="home-avatar" aria-label="Открыть меню пользователя" aria-expanded={menu} onClick={event => { setAvatar(event.currentTarget); panel?.close(); if (menu) document.querySelector('.home-user-menu')?.dispatchEvent(new Event('overlay-close')); else setMenu(true) }}>{user.initials}</button>{menu && <AvatarMenu summary={summary} close={closeMenu} returnTo={avatar} logout={onLogout} />}</div></header><h1 className="home-mobile home-mobile-title">{section.title}</h1>
    <Suspense fallback={null}><Component session={session} summary={summary} api={api} onSessionLost={onSessionLost} onLogout={onLogout} setPanel={setPanel} closeMenu={closeMenu} /></Suspense>
    </div><div className="home-panel-slot">{panel?.content}</div></main><div className="home-tabbar-wrap"><Navigation mobile /></div></div>
}
