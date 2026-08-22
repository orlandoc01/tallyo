import { setupWorker } from 'msw/browser'
import { setTokens } from '../auth/tokenStore'
import { handlers } from './handlers'

const stubScopes = [
  'read:spending',
  'read:cashflow',
  'read:transactions',
  'write:transactions',
  'read:accounts',
  'write:accounts',
  'read:owners',
  'write:owners',
  'read:rules',
  'write:rules',
  'read:categories',
  'write:categories',
  'read:users',
  'write:users',
  'read:budgets',
  'write:budgets',
  'read:assets',
  'write:assets',
  'read:wealth',
  'write:wealth',
  'read:holdings',
  'read:portfolio',
  'read:settings',
  'write:settings',
]

const worker = setupWorker(...handlers)

export async function startStubApi() {
  setTokens(createStubJwt(stubScopes), 'stub-refresh-token')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

function createStubJwt(scopes: string[]) {
  const header = base64UrlEncode({ alg: 'none', typ: 'JWT' })
  const payload = base64UrlEncode({
    sub: 'stub@example.com',
    scope: scopes.join(' '),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  })

  return `${header}.${payload}.`
}

function base64UrlEncode(value: unknown) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
