import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DepositForm } from '../src/cabinet/deposit/DepositForm'
import { detailedConfigs } from '../src/cabinet/deposit/forms-model'
import { configKey } from '../src/cabinet/deposit/model'
import { formConfigs, formsFixture } from './deposit-forms-fixtures'
import '../src/styles.css'
const params = new URLSearchParams(location.search),
  kind = params.get('kind') === 'wire' ? 'wire' : 'crypto',
  scene = params.get('scene') ?? 'data',
  f = formsFixture(scene)
if (scene === 'loading') f.state.delay = 60000
await f.session.check()
if (params.get('present') === '1')
  document.getElementById('test-transport-label')!.hidden = true
Object.assign(globalThis, {
  depositTest: {
    posts: () => f.state.posts,
    paths: () => f.state.calls.map((c) => c.method + ' ' + c.path),
    markers: () => f.markers.size,
  },
})
createRoot(document.getElementById('test-root')!).render(
  createElement(DepositForm, {
    kind,
    methodKey: configKey(detailedConfigs(formConfigs)[3]),
    reader: f.formApi,
    onBack() {
      document.getElementById('test-transport-label')!.hidden = false
      document.getElementById('test-transport-label')!.textContent =
        'ТЕСТ · Возврат к способам пополнения'
    },
    onSessionLost() {
      document.getElementById('test-transport-label')!.hidden = false
      document.getElementById('test-transport-label')!.textContent =
        'ТЕСТ · Сессия завершена'
    },
  }),
)
