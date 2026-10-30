import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

test('application CSS uses theme durations, curves, text colors and normal tracking', async () => {
  for (const path of ['src/styles.css', 'src/cabinet/home.css']) {
    const css = await readFile(new URL('../' + path, import.meta.url), 'utf8')
    assert.doesNotMatch(css, /letter-spacing:\s*-/)
    assert.doesNotMatch(css, /(?:^|[;{])\s*color:\s*(?:#[\da-f]+|rgba?\(|white\b)/im)
    for (const [, declaration] of css.matchAll(/(?:animation(?:-duration|-timing-function)?|transition(?:-duration|-timing-function)?):\s*([^;}]+)/g)) {
      // Zero duration is intentional for reduced motion. Linear is required for
      // continuous spinner/shimmer; all other curves belong to the theme.
      assert.doesNotMatch(declaration, /(?<![\w-])(?:[1-9]\d*|0?\.\d+)(?:ms|s)\b/, path)
      assert.doesNotMatch(declaration, /(?<![\w-])ease(?:-in-out|-in|-out)?\b|cubic-bezier\(/, path)
    }
  }
})

test('font declarations reference local Inter subsets with their license', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /Manrope|fonts\.google|https?:/i)
  assert.equal((css.match(/font-display: block/g) ?? []).length, 2)
  const fonts = await readdir(new URL('../src/assets/fonts/', import.meta.url))
  for (const font of ['inter-latin-wght-normal.woff2', 'inter-cyrillic-wght-normal.woff2', 'OFL-Inter.txt']) assert.ok(fonts.includes(font))
})
