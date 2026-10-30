export interface AuthConfig { apiUrl: string; domainName: string }
const defaults: AuthConfig = { apiUrl: 'https://api3.soft-fx.com', domainName: 'client.soft-fx.com' }

export function parseAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const apiUrl = env.VITE_API_URL ?? defaults.apiUrl
  const domainName = env.VITE_DOMAIN_NAME ?? defaults.domainName
  let url: URL
  try { url = new URL(apiUrl) }
  catch { throw new Error('VITE_API_URL: укажите абсолютный HTTPS URL API.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_URL: нужен HTTPS URL без учётных данных, query и fragment.')
  }
  if (!domainName.trim()) throw new Error('VITE_DOMAIN_NAME: домен компании не может быть пустым.')
  return { apiUrl: url.href.replace(/\/+$/, ''), domainName: domainName.trim() }
}

export function sessionKeys(config: AuthConfig) {
  // Preserve existing default sessions, but never send them to another API/company.
  const prefix = config.apiUrl === defaults.apiUrl && config.domainName === defaults.domainName
    ? 'clientcabinet.api3.com.session'
    : `clientcabinet.session.${encodeURIComponent(JSON.stringify([config.apiUrl, config.domainName]))}`
  return { key: `${prefix}.v1`, epoch: `${prefix}.epoch`, lock: prefix }
}

// Vite supplies public build-time values; direct Node tests use the defaults.
export const authConfig = parseAuthConfig(import.meta.env ?? {})
