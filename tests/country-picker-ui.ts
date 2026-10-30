import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RegistrationForm } from '../src/RegistrationForm'
import { CabinetApi } from '../src/auth/api'
import { Registration } from '../src/auth/registration'
import '../src/styles.css'

// Open /tests/country-picker-ui.html on the dev server. No network or new dependencies.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const countries = [{ code: 'DE', name: 'GERMANY' }, { code: 'AR', name: 'ARGENTINA' }, { code: 'AM', name: 'ARMENIA' }, { code: 'AW', name: 'ARUBA' }]
let mutations = 0
const api = new CabinetApi(async (input, init) => {
  if ((init?.method ?? 'GET') !== 'GET') { mutations++; throw new Error('Mutations forbidden in this test') }
  const path = new URL(String(input)).pathname
  const body = path === '/profile/country' ? countries : path === '/verification/user/type' ? [{ name: 'Personal', isEditable: false }] : undefined
  if (!body) throw new Error('Unexpected request')
  return new Response(JSON.stringify(body))
})
const root = createRoot(document.getElementById('test-root')!)
const output = document.getElementById('test-results')!
const messages: string[] = []
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function get<T extends Element>(selector: string) { const node = document.querySelector<T>(selector); assert(node, 'Missing ' + selector); return node }
const field = () => get<HTMLButtonElement>('#country')
const search = () => get<HTMLInputElement>('[role=combobox]')
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role=option]'))
async function settleClose() {
  const panel = document.querySelector('.is-closing .country-picker')
  if (panel) await act(async () => { await Promise.all(panel.getAnimations().map(animation => animation.finished)) })
}
async function click(element: HTMLElement) { await act(async () => element.click()); await settleClose() }
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value)
    search().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function key(key: string) { await act(async () => search().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); await settleClose() }
async function check(name: string, run: () => Promise<void>) {
  try { await run(); messages.push('PASS ' + name) }
  catch (error) { messages.push('FAIL ' + name + ': ' + String(error)); throw error }
  finally { output.textContent = messages.join('\n') }
}
async function run() {
  await act(async () => root.render(createElement('div', { className: 'registration-page' }, createElement(RegistrationForm, {
    create: () => new Registration(api, async () => { throw new Error('Submission forbidden') }), onLogin: () => {}, onSuccess: () => {},
  }))))
  for (let attempt = 0; field().disabled && attempt < 100; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  await check('opening focuses search and exposes dialog/listbox/options', async () => {
    assert(!field().disabled, 'Configuration not loaded')
    assert(field().getAttribute('aria-haspopup') === 'listbox', 'Missing haspopup')
    await click(field())
    assert(get<HTMLDialogElement>('dialog').open, 'Dialog closed')
    assert(document.activeElement === search(), 'Search not focused')
    assert(rows().length === 4 && rows().every(row => row.hasAttribute('aria-selected')), 'Options missing')
  })
  await check('Tab keeps focus between search and close inside the modal', async () => {
    await key('Tab'); assert(document.activeElement === get('.picker-close'), 'Tab left the dialog')
    await act(async () => get('.picker-close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    assert(document.activeElement === search(), 'Tab did not return to search')
  })
  for (const query of ['гЕрМ', 'gErMaNy', 'dE']) await check('search ' + query, async () => {
    await fill(query); assert(rows().length === 1 && rows()[0].textContent?.includes('Германия'), 'Wrong filtered country')
  })
  await check('empty result and Enter cannot submit registration', async () => {
    await fill('Атлан'); assert(rows().length === 0, 'Unexpected results')
    assert(get('.picker-empty').textContent?.includes('Страна не найдена'), 'Missing empty state')
    await key('Enter'); assert(get<HTMLDialogElement>('dialog').open, 'Enter closed an empty list')
  })
  await check('arrow keys move highlight, Enter selects original API code in the registration form', async () => {
    await fill('Ар'); await key('ArrowDown'); await key('ArrowDown')
    assert(search().getAttribute('aria-activedescendant') === rows()[1].id, 'Down did not move highlight')
    await key('ArrowUp'); assert(search().getAttribute('aria-activedescendant') === rows()[0].id, 'Up did not move highlight')
    await key('Enter')
    assert(!document.querySelector('dialog'), 'Selection did not close dialog')
    assert(new FormData(get<HTMLFormElement>('form')).get('country') === 'AR', 'Form did not receive API code')
    assert(field().textContent?.includes('Аргентина'), 'Label not updated')
    assert(document.activeElement === field(), 'Focus not restored after selection')
  })
  await check('reopening preserves selection; Escape cancel returns focus', async () => {
    await click(field()); assert(rows()[0].getAttribute('aria-selected') === 'true', 'Selection lost')
    // Native Escape generates cancel; also exercise physical Escape in browser QA.
    await act(async () => get('dialog').dispatchEvent(new Event('cancel', { cancelable: true })))
    await settleClose()
    assert(!document.querySelector('dialog') && document.activeElement === field(), 'Cancel did not return focus')
  })
  await check('close button restores focus', async () => {
    await click(field()); await click(get<HTMLButtonElement>('.picker-close'))
    assert(!document.querySelector('dialog') && document.activeElement === field(), 'Close failed')
  })
  await check('clicking outside closes; clicking inside does not', async () => {
    await click(field()); await click(get<HTMLElement>('.picker-head'))
    assert(get<HTMLDialogElement>('dialog').open, 'Click inside closed dialog')
    await click(get<HTMLDialogElement>('dialog'))
    assert(!document.querySelector('dialog') && document.activeElement === field(), 'Outside click failed')
  })
  await check('mouse selection preserves code and no registration mutations are made', async () => {
    await click(field()); await fill('Germany'); await click(rows()[0])
    assert(new FormData(get<HTMLFormElement>('form')).get('country') === 'DE', 'Mouse selection failed')
    assert(mutations === 0, 'Unexpected mutation')
  })
  await act(async () => root.unmount())
  output.dataset.result = 'passed'
  output.textContent += `\n${messages.length} UI tests passed. Real API requests: 0.`
}
void run().catch(() => { output.dataset.result = 'failed' })
