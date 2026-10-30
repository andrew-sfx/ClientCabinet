import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const SWAGGER_URL = 'https://api3.soft-fx.com/swagger/api/swagger.json'
export const BASELINE_URL = new URL('../sources/cabinet/version-baseline.json', import.meta.url)
export const FLOW_PATHS = ['/user/login/configuration', '/user/login', '/identity/configuration', '/identity/verify', '/identity/sendcode', '/token', '/token/revoke', '/user/account/summary', '/user/registration',
  '/paymentsystem/configuration', '/paymentsystem/currency', '/paymentsystem/fee', '/paymentsystem/amountrange',
  '/paymentsystem/crypto/token', '/paymentsystem/cryptoaddress/create', '/paymentsystem/wiretransfer/bank', '/paymentsystem/wiretransfer/add',
  '/account', '/user/account/balance', '/user/summary', '/paymentsystem/exchange/currencyrate']

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

function versionParts(value) {
  if (typeof value !== 'string' || !/^v?\d+\.\d+\.\d+\.\d+$/.test(value)) throw new Error('Expected a four-part API version; manual review required.')
  return value.replace(/^v/, '').split('.').map(Number)
}

// Preserve operations plus all transitive local references, including recursive schemas.
export function extractFlow(spec, paths = FLOW_PATHS) {
  versionParts(spec?.info?.version)
  if (!spec.paths || typeof spec.paths !== 'object') throw new Error('Swagger paths are missing.')
  const result = { openapi: spec.openapi ?? spec.swagger, security: spec.security ?? [], paths: {}, references: {} }
  if (!result.openapi) throw new Error('OpenAPI format is missing.')
  const visited = new Set()
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.$ref === 'string') {
      const ref = value.$ref
      if (!ref.startsWith('#/')) throw new Error('External reference requires manual review: ' + ref)
      if (!visited.has(ref)) {
        visited.add(ref)
        const target = ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec)
        if (target === undefined) throw new Error('Unresolved reference: ' + ref)
        result.references[ref] = target
        visit(target)
      }
    }
    for (const child of Object.values(value)) visit(child)
  }
  for (const path of paths) {
    if (!spec.paths[path]) throw new Error('Required flow path is missing: ' + path)
    result.paths[path] = spec.paths[path]
    visit(spec.paths[path])
  }
  // Security schemes can be named without a $ref.
  result.securitySchemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {}
  visit(result.securitySchemes)
  return canonical(result)
}

export function createBaseline(spec, checkedAt = new Date().toISOString()) {
  return { schemaVersion: 1, swaggerUrl: SWAGGER_URL, checkedAt, version: spec.info.version, fullContractSha256: hash(spec), flowPaths: FLOW_PATHS, flow: extractFlow(spec) }
}

function differences(before, after, path = '', changes = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return changes
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) differences(before[key], after[key], path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), changes)
  } else changes.push({ path: path || '/', kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed' })
  return changes
}

export function compareApi(baseline, spec) {
  if (baseline.schemaVersion !== 1 || baseline.swaggerUrl !== SWAGGER_URL) throw new Error('Unexpected baseline format or API URL.')
  const oldParts = versionParts(baseline.version)
  const newParts = versionParts(spec?.info?.version)
  const changes = differences(canonical(baseline.flow), extractFlow(spec, baseline.flowPaths))
  const prefixChanged = oldParts.slice(0, 3).some((part, index) => part !== newParts[index])
  const versionChanged = oldParts.some((part, index) => part !== newParts[index])
  const documentChanged = baseline.fullContractSha256 !== hash(spec)
  const kind = prefixChanged ? 'version-family-change' : versionChanged ? 'compatible-revision' : changes.length ? 'flow-change-with-same-version' : documentChanged ? 'outside-flow-change' : 'unchanged'
  return { baselineVersion: baseline.version, currentVersion: spec.info.version, kind, reviewRequired: documentChanged || versionChanged || changes.length > 0, changes }
}

export async function fetchSwagger(fetcher = fetch) {
  const response = await fetcher(SWAGGER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('Swagger HTTP ' + response.status)
  const spec = await response.json()
  extractFlow(spec)
  return spec
}

async function main() {
  const baseline = JSON.parse(await readFile(BASELINE_URL, 'utf8'))
  const result = compareApi(baseline, await fetchSwagger())
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (result.reviewRequired) process.exitCode = 2
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never report transport/format errors as an unchanged API; do not print response bodies.
    process.stderr.write('API version check failed: Swagger unavailable, invalid or incompatible. Manual investigation required. Baseline unchanged.\n')
    process.exitCode = 1
  })
}
