/* eslint-disable react-refresh/only-export-components */
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router'
import { Provider, type Client } from 'urql'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import { MobileHeaderProvider } from '../components/layout/MobileHeaderContext'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { createGraphqlClient } from '../graphql/client'

const fullAccessScopes = [
  'read:users', 'write:users',
  'read:transactions', 'write:transactions',
  'read:accounts', 'write:accounts',
  'read:rules', 'write:rules',
  'read:categories', 'write:categories',
  'read:spending', 'read:cashflow',
  'read:wealth', 'write:wealth',
  'read:holdings',
  'read:portfolio',
  'read:budgets', 'write:budgets',
  'read:assets', 'write:assets',
]

const defaultAuthContext: AuthContextValue = {
  isAuthenticated: true,
  isLoading: false,
  scopes: fullAccessScopes,
  masterPasswordStatus: 'ENABLED',
  emailAuthEnabled: false,
  googleAuthEnabled: false,
  webauthnEnabled: false,
  disableAllAuth: false,
  disableTransactionTracking: false,
  disableWealthTracking: false,
  hideOwners: false,
  setupComplete: true,
  login: () => {},
  loginWithPasskey: async () => {},
  loginWithMasterPassword: () => {},
  loginWithEmail: () => {},
  refreshGeneralConfiguration: async () => {},
  logout: () => {},
}

type ProviderOptions = {
  initialEntries?: string[]
  auth?: Partial<AuthContextValue>
  withGraphql?: boolean
  graphqlClient?: Client
  withMobileHeader?: boolean
  router?: 'browser' | 'memory'
  probes?: ReactNode
}

type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & ProviderOptions

type TestProvidersProps = { children: ReactNode } & ProviderOptions

function providerTree(ui: ReactNode, options: ProviderOptions = {}) {
  const { initialEntries = ['/'], auth, withGraphql = false, graphqlClient, withMobileHeader = false, router = 'memory', probes } = options
  const authValue = auth ? { ...defaultAuthContext, ...auth } : null
  let tree = <>{probes}{ui}</>

  if (withMobileHeader) tree = <MobileHeaderProvider>{tree}</MobileHeaderProvider>
  if (authValue) tree = <AuthContext.Provider value={authValue}>{tree}</AuthContext.Provider>

  tree = router === 'browser'
    ? <BrowserRouter>{tree}</BrowserRouter>
    : <MemoryRouter initialEntries={initialEntries}>{tree}</MemoryRouter>
  if (withGraphql || graphqlClient) tree = <Provider value={graphqlClient ?? createGraphqlClient()}>{tree}</Provider>

  return tree
}

export function renderWithProviders(ui: ReactNode, options: RenderWithProvidersOptions = {}) {
  const { initialEntries, auth, withGraphql, graphqlClient, withMobileHeader, router, probes, ...renderOptions } = options
  return render(providerTree(ui, { initialEntries, auth, withGraphql, graphqlClient, withMobileHeader, router, probes }), renderOptions)
}

export function createProvidersWrapper(options: ProviderOptions = {}) {
  const graphqlClient = options.graphqlClient ?? (options.withGraphql ? createGraphqlClient() : undefined)

  return function ProvidersWrapper({ children }: { children: ReactNode }) {
    return providerTree(children, { ...options, graphqlClient })
  }
}

export function TestProviders({ children, ...options }: TestProvidersProps) {
  return providerTree(children, options)
}

export function GraphqlTestProvider({ children }: { children: ReactNode }) {
  return providerTree(children, { withGraphql: true })
}

export function MobileHeaderActionsHost() {
  const mobile = useMobileHeader()
  return <div data-testid="mobile-header-actions">{mobile.headerActions}</div>
}

export function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

export function LocationSearch() {
  const location = useLocation()
  return <div data-testid="location-search">{location.search}</div>
}

export function LocationPathname() {
  const location = useLocation()
  return <div data-testid="location-pathname">{location.pathname}</div>
}
