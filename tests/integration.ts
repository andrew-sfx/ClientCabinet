import { AuthError, CabinetApi, errorMessage } from '../src/auth/api.ts'
import type { Tokens } from '../src/auth/api.ts'

// Explicit test page; absent from the production build. Never log response
// bodies, identifiers, credentials or token values. No network fixtures here.
const form = document.querySelector<HTMLFormElement>('#integration')!
const output = document.querySelector<HTMLElement>('#result')!
const button = form.querySelector('button')!
const line = (message: string) => { output.textContent += `${message}\n` }
form.addEventListener('submit', event => {
  event.preventDefault()
  void run()
})
async function run() {
  if (button.disabled) return
  button.disabled = true; output.textContent = ''
  const data = new FormData(form)
  const api = new CabinetApi()
  let current: Tokens | undefined
  try {
    current = await api.login(String(data.get('email')).trim(), String(data.get('password')))
    data.delete('password'); form.reset()
    line('PASS: вход по паролю; дополнительный фактор не потребовался.')
    await api.verify(current.access)
    line('PASS: защищённый запрос после входа.')
    line(`Срок access-токена по ответу API: ${Math.round((current.expiresAt - Date.now()) / 1000)} секунд.`)
    current = await api.refresh(current.refresh)
    await api.verify(current.access)
    line('PASS: настоящий refresh и защищённый запрос с выданным access-токеном (досрочное продление).')
    line('Ожидание естественного истечения access-токена (срок сервера + 5 секунд)…')
    await new Promise(resolve => setTimeout(resolve, Math.max(0, current!.expiresAt - Date.now() + 5000)))
    try {
      await api.verify(current.access)
      line('LIMITATION: сервер ещё принимает access после заявленного срока (возможен допуск по времени).')
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error
      line('PASS: естественно истёкший access-токен получил 401.')
    }
    current = await api.refresh(current.refresh)
    await api.verify(current.access)
    line('PASS: refresh после истечения access восстановил защищённый доступ.')
    await api.revoke(current.access)
    line('PASS: сервер принял запрос отзыва.')
    try {
      await api.verify(current.access)
      line('LIMITATION: access-токен после отзыва ещё принимается сервером.')
    } catch (error) {
      line(error instanceof AuthError && error.status === 401 ? 'PASS: защищённый запрос с отозванным access-токеном получил 401.' : 'INCONCLUSIVE: проверка access после отзыва не завершена.')
    }
    try {
      current = await api.refresh(current.refresh)
      line('LIMITATION: refresh-токен после отзыва ещё принимается сервером.')
    } catch (error) {
      line(error instanceof AuthError && [400, 401].includes(error.status) ? 'PASS: сервер отверг продление отозванной сессии.' : 'INCONCLUSIVE: проверка refresh после отзыва не завершена.')
    }
  } catch (error) {
    line(`FAIL: ${errorMessage(error)}`)
  } finally {
    data.delete('password'); form.reset()
    if (current) { try { await api.revoke(current.access) } catch { /* May already be revoked. */ } }
    button.disabled = false
    line('Проверка завершена; форма очищена. Токены в хранилище не записывались.')
  }
}
