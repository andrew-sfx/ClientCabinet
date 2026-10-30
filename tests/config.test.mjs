import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAuthConfig, sessionKeys } from '../src/auth/config.ts'

test('auth configuration defaults apply only to absent values', () => {
  assert.deepEqual(parseAuthConfig({}), { apiUrl: 'https://api3.soft-fx.com', domainName: 'client.soft-fx.com' })
})

test('auth configuration accepts overrides and normalizes trailing slashes', () => {
  assert.deepEqual(parseAuthConfig({ VITE_API_URL: 'https://api.example.invalid/v1/', VITE_DOMAIN_NAME: ' company.example.invalid ' }),
    { apiUrl: 'https://api.example.invalid/v1', domainName: 'company.example.invalid' })
})

test('auth configuration rejects invalid API URLs instead of substituting defaults', () => {
  for (const value of ['', ' ', '/api', 'http://api.example.invalid', 'not-a-url', 'https://user:password@example.invalid', 'https://example.invalid?tenant=1', 'https://example.invalid#api']) {
    assert.throws(() => parseAuthConfig({ VITE_API_URL: value }), /VITE_API_URL/)
  }
})

test('auth configuration rejects an explicitly empty company domain', () => {
  for (const value of ['', '   ']) assert.throws(() => parseAuthConfig({ VITE_DOMAIN_NAME: value }), /VITE_DOMAIN_NAME/)
})

test('default configuration preserves existing storage and lock keys', () => {
  assert.deepEqual(sessionKeys(parseAuthConfig({})), {
    key: 'clientcabinet.api3.com.session.v1', epoch: 'clientcabinet.api3.com.session.epoch', lock: 'clientcabinet.api3.com.session',
  })
})

test('a different API or company cannot reuse session storage or locks', () => {
  const variants = [{}, { VITE_API_URL: 'https://api.example.invalid' }, { VITE_DOMAIN_NAME: 'another.example.invalid' }]
    .map(env => sessionKeys(parseAuthConfig(env)))
  for (const field of ['key', 'epoch', 'lock']) assert.equal(new Set(variants.map(keys => keys[field])).size, variants.length)
})
