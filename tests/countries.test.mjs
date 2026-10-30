import test from 'node:test'
import assert from 'node:assert/strict'
import { countryOptions, filterCountries, prefixLength } from '../src/countries.ts'

const source = [{ code: 'DE', name: 'GERMANY' }, { code: 'AR', name: 'ARGENTINA' }, { code: 'AM', name: 'ARMENIA' }, { code: 'AW', name: 'ARUBA' }]
const options = countryOptions(source)

test('country labels come from Russian Intl names and are sorted without mutating the API data', () => {
  assert.deepEqual(options.map(c => c.label), ['Аргентина', 'Армения', 'Аруба', 'Германия'])
  assert.equal(options.find(c => c.code === 'DE').name, 'GERMANY')
  assert.equal(source[0].code, 'DE')
})
test('unknown and invalid region codes fall back to readable API names, keeping the original code', () => {
  assert.deepEqual(countryOptions([{ code: 'not-iso', name: 'TEST TERRITORY' }, { code: 'AA', name: 'ANOTHER TERRITORY' }]).map(c => [c.code, c.label]), [['AA', 'Another Territory'], ['not-iso', 'Test Territory']])
  assert.equal(countryOptions([{ code: 'AA', name: 'ÅLAND ISLANDS' }])[0].label, 'Åland Islands')
  assert.equal(countryOptions([{ code: 'AA', name: 'CÔTE D’IVOIRE' }])[0].label, 'Côte D’Ivoire')
})
for (const query of ['геРМ', 'gErMaNy', 'dE']) test(`country search matches ${query} without case sensitivity`, () => {
  assert.deepEqual(filterCountries(options, query).map(c => c.code), ['DE'])
})
test('empty search restores the list; a missing country returns no results', () => {
  assert.deepEqual(filterCountries(options, '  '), options)
  assert.deepEqual(filterCountries(options, 'Атлан'), [])
})
test('only a matching prefix is accented; search text is literal, including punctuation', () => {
  assert.equal(prefixLength('Армения', ' ар '), 2)
  assert.equal(prefixLength('Армения', 'мени'), 0)
  assert.equal(prefixLength('Армения', ''), 0)
  assert.deepEqual(filterCountries(options, '['), [])
  assert.deepEqual(filterCountries(countryOptions([...source, { code: 'BG', name: 'BULGARIA' }]), 'Ар').map(c => c.code), ['AR', 'AM', 'AW'])
})
