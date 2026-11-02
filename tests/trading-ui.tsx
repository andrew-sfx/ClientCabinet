import { createRoot } from 'react-dom/client'
import { CabinetShell } from '../src/cabinet/CabinetShell'
import { TradingView } from '../src/cabinet/trading/TradingSection'
import { sections } from '../src/cabinet/sections'
import { tradingFixture } from './trading-fixtures'
import type { SectionProps } from '../src/cabinet/section-types'
import '../src/styles.css'
const params = new URLSearchParams(location.search), f = await tradingFixture(params.get('s') ?? 'list')
const registry = sections.map(s => s.id === 'trading' ? { ...s, component: (props: SectionProps) => <TradingView {...props} tradingApi={f.api} /> } : s)
history.replaceState(null,'','/cabinet/trading')
createRoot(document.getElementById('root')!).render(<CabinetShell session={f.session} api={f.home} registry={registry} onSessionLost={() => { throw new Error('Synthetic session lost') }} onLogout={() => {}} />)
Object.assign(globalThis,{ tradingFixtureState:f.tradingState })
