/* global document, innerWidth */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: 'localhost', port: 0, strictPort: false } })
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch({ headless: true })
  for (const width of [1440, 760, 390, 320]) {
    for (const suite of ['login', 'country-picker', 'home', 'router', 'scroll']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await page.goto(origin + '/tests/' + suite + '-ui.html' + (suite === 'scroll' ? '?test=1' : ''))
      await page.waitForFunction(() => {
        const result = document.getElementById('test-results')
        return result?.dataset.status || result?.dataset.result
      }, null, { timeout: 60000 })
      const result = await page.locator('#test-results').evaluate(element => ({ status: element.dataset.status ?? element.dataset.result, text: element.textContent }))
      assert.equal(result.status, 'passed', suite + ' @ ' + width + ': ' + result.text)
      console.log('PASS ' + suite + ' @ ' + width)
      await page.close()
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(origin + '/tests/deposit-forms-ui.html')
    const trigger = page.locator('[data-picker="account"]')
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await trigger.evaluate(element => !!element.closest('[inert]')), true, 'Modal background is interactive')
    await trigger.evaluate(element => element.focus())
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Focus escaped modal')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await dialog.locator('button').last().evaluate(element => element === document.activeElement), true, 'Reverse tab did not wrap')
    await page.keyboard.press('Tab')
    assert.equal(await dialog.locator('button').first().evaluate(element => element === document.activeElement), true, 'Tab did not wrap')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate(element => element === document.activeElement && !element.closest('[inert]')), true, 'Focus/background not restored')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Deposit overflows')
    console.log('PASS deposit modal @ ' + width)
    await page.close()
  }
} finally { await browser?.close(); await server.close() }
