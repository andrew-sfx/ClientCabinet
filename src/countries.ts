import type { Country } from './auth/registration'

export interface CountryOption extends Country { label: string }
const regionNames = new Intl.DisplayNames(['ru'], { type: 'region', fallback: 'none' })
const lower = (value: string) => value.toLocaleLowerCase('ru')

export function countryOptions(countries: Country[]): CountryOption[] {
  return countries.map(country => {
    let label: string | undefined
    try { label = regionNames.of(country.code.toUpperCase()) } catch { /* Keep an unknown API code selectable. */ }
    const fallback = country.name.toLocaleLowerCase('en').replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase('en'))
    return { ...country, label: label || fallback }
  }).sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

export function filterCountries(countries: CountryOption[], query: string) {
  const term = lower(query.trim())
  return countries.filter(country => [country.label, country.name, country.code].some(value => lower(value).startsWith(term)))
}

export function prefixLength(value: string, query: string) {
  const term = query.trim()
  return term && lower(value).startsWith(lower(term)) ? term.length : 0
}
