// To connect a section, import its component and set component on its entry below.
// The component receives SectionProps; navigation and direct URLs then enable automatically.
import { HomeSection } from './CabinetHome'
import { DepositSection } from './deposit/DepositMethods'
import type { CabinetSection } from './section-types'

export const sections: CabinetSection[] = [
  { id: 'home', path: '/cabinet', title: 'Главная', component: HomeSection },
  { id: 'trading', path: '/cabinet/trading', title: 'Торговые счета' },
  { id: 'prop', path: '/cabinet/prop', title: 'Prop Trading' },
  { id: 'deposit', path: '/cabinet/deposit', title: 'Пополнить', component: DepositSection, standalone: true },
  { id: 'withdraw', path: '/cabinet/withdraw', title: 'Вывести' },
  { id: 'exchange', path: '/cabinet/exchange', title: 'Обмен' },
  { id: 'transfer', path: '/cabinet/transfer', title: 'Перевод' },
  { id: 'verification', path: '/cabinet/verification', title: 'Верификация' },
  { id: 'settings', path: '/cabinet/settings', title: 'Настройки' },
]

export function resolveSection(path: string, registry = sections) {
  return registry.find(section => section.path === path && section.component) ?? registry.find(section => section.id === 'home')!
}
