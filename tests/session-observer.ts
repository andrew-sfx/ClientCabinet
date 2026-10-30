import { SESSION_KEY } from '../src/auth/session.ts'
import { object } from '../src/auth/api.ts'

const state = document.querySelector<HTMLElement>('#state')!
const events = document.querySelector<HTMLElement>('#events')!
let previous = object(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'))
let rotations = 0
function render() {
  const current = object(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'))
  state.textContent = `Сессия в localStorage: ${current.access ? 'есть' : 'нет'}\nОбновлений токена после открытия наблюдателя: ${rotations}\nДо истечения access: ${typeof current.expiresAt === 'number' ? Math.round((current.expiresAt - Date.now()) / 1000) : '—'} секунд`
}
window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage || (event.key !== SESSION_KEY && event.key !== null)) return
  const current = object(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'))
  if (previous.access && current.access && previous.access !== current.access) {
    rotations++
    events.textContent += `Токен обновлён. До истечения предыдущего оставалось ${Math.round((Number(previous.expiresAt) - Date.now()) / 1000)} секунд.\n`
  }
  if (previous.access && !current.access) events.textContent += 'Общая сессия удалена.\n'
  previous = current
  render()
})
render()
setInterval(render, 1000)
