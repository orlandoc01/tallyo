import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { runPasskeyRegistration } from '../auth/webauthn'
import { captureMutation, mockGraphqlError, mockQuery } from '../test/msw'
import { renderWithProviders } from '../test/renderWithProviders'
import type { Configuration } from '../types/graphql'
import { AuthConfigStep } from './setup/AuthConfigStep'
import { CompleteStep } from './setup/CompleteStep'
import { ConnectionsStep } from './setup/ConnectionsStep'
import { OwnersStep } from './setup/OwnersStep'
import { PasswordSetupStep } from './setup/PasswordSetupStep'
import { RegisterAccountStep } from './setup/RegisterAccountStep'
import { SecurityChoiceStep } from './setup/SecurityChoiceStep'
import { SetupContext } from './setup/setupContextValue'
import { SetupProvider } from './setup/SetupContext'
import { buildSetupConfigurationInput } from './setup/setupConfigurationInput'
import { initialSetupState, type SetupState } from './setup/setupState'
import { WelcomeStep } from './setup/WelcomeStep'
import { server } from '../mocks/server'

vi.mock('../auth/webauthn', () => ({
  runPasskeyRegistration: vi.fn(async () => ({ id: 'cred-1', name: 'My passkey', createdAt: '2026-06-15T00:00:00Z' })),
}))

type AuthOverride = NonNullable<Parameters<typeof renderWithProviders>[1]>['auth']

const authContextValue: AuthOverride = {
  isAuthenticated: false,
  scopes: [],
  disableAllAuth: true,
  setupComplete: false,
}

const authContextWithoutMasterPassword: AuthOverride = {
  ...authContextValue,
  masterPasswordStatus: 'DISABLED',
}

const setupConfiguration: Configuration = {
  __typename: 'Configuration',
  configFilePath: null,
  dbPath: '/data/tallyo.db',
  port: '8080',
  syncOff: false,
  locale: { __typename: 'Locale', timezone: 'UTC' },
  general: { __typename: 'GeneralConfiguration', disableTransactionTracking: false, disableWealthTracking: false, hideOwners: false },
  authorization: { __typename: 'AuthorizationConfiguration', masterPassword: '********', disableAllAuth: false, oauthIssuerUrl: 'http://localhost:3000', frontendRedirectUris: ['http://localhost:3000/auth/callback'], accessTokenLifetime: '15m0s', refreshTokenLifetime: '168h0m0s', devCorsAllowedOrigins: [] },
  llmCategorization: {
    __typename: 'LlmCategorizationConfiguration',
    enabled: false,
    provider: 'OLLAMA',
    allowedProviders: ['OLLAMA'],
    ollama: { __typename: 'OllamaProviderConfiguration', url: null, model: '' },
  },
  googleAuthn: { __typename: 'GoogleAuthnConfiguration', enabled: false, googleClientId: null, googleClientSecret: null },
  passKeyAuthn: { __typename: 'PassKeyAuthnConfiguration', enabled: false, webauthnRpId: null, webauthnRpName: 'Tallyo', webauthnRpOrigins: [] },
  emailCodeAuthn: { __typename: 'EmailCodeAuthnConfiguration', enabled: false, smtpHost: null, smtpPort: '587', smtpFrom: null, smtpUsername: null, smtpPassword: null },
  mcp: { __typename: 'McpConfiguration', enabled: false, dynamicRedirectHosts: [] },
  security: { __typename: 'SecurityConfiguration', trustedProxyCidrs: [] },
}

function renderSetup(route: string, element: ReactNode, nextPath: string, nextLabel: string) {
  return renderSetupWithAuth(route, element, nextPath, nextLabel, authContextValue)
}

function renderSetupWithAuth(route: string, element: ReactNode, nextPath: string, nextLabel: string, authContext: AuthOverride) {
  return renderSetupFlow(
    route,
    <>
      <Route element={element} path={route} />
      <Route element={<h1>{nextLabel}</h1>} path={nextPath} />
    </>,
    authContext,
  )
}

function renderSetupFlow(route: string, routes: ReactNode, authContext: AuthOverride = authContextValue) {
  return renderWithProviders(
    <SetupProvider>
      <Routes>{routes}</Routes>
    </SetupProvider>,
    { auth: authContext, initialEntries: [route], withGraphql: true },
  )
}

describe('setup wizard pages', () => {
  it('builds setup completion input for password and OAuth flows', () => {
    const base: SetupState = {
      passwordEnabled: true,
      oauthEnabled: false,
      masterPassword: 'master-password',
      passkeyEnabled: false,
      googleEnabled: false,
      emailEnabled: false,
      oauthIssuerUrl: 'https://spend.example',
      frontendRedirectUris: 'https://spend.example/auth/callback',
      googleClientId: '',
      googleClientSecret: '',
      smtpHost: '',
      smtpPort: '587',
      smtpFrom: '',
      smtpUsername: '',
      smtpPassword: '',
      webauthnRpId: '',
      webauthnRpName: 'Tallyo',
      webauthnRpOrigins: '',
      registeredEmail: '',
    }

    expect(buildSetupConfigurationInput(base)).toMatchObject({ setupComplete: true, authorization: { masterPassword: 'master-password' } })
    expect(buildSetupConfigurationInput({
      ...base,
      oauthEnabled: true,
      passkeyEnabled: true,
      googleEnabled: true,
      emailEnabled: true,
      googleClientId: 'client',
      googleClientSecret: 'secret',
      smtpHost: 'smtp.example.com',
      smtpFrom: 'noreply@example.com',
      webauthnRpId: 'spend.example',
      webauthnRpOrigins: 'https://spend.example, http://localhost:5173',
    })).toMatchObject({
      setupComplete: true,
      authorization: { masterPassword: 'master-password', frontendRedirectUris: ['https://spend.example/auth/callback'] },
      passKeyAuthn: { enabled: true, webauthnRpId: 'spend.example', webauthnRpOrigins: ['https://spend.example', 'http://localhost:5173'] },
      googleAuthn: { enabled: true, googleClientId: 'client', googleClientSecret: 'secret' },
      emailCodeAuthn: { enabled: true, smtpHost: 'smtp.example.com', smtpFrom: 'noreply@example.com' },
    })
  })

  it('configures OAuth providers and continues', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/oauth-setup', <AuthConfigStep />, '/setup/register', 'Register next')

    await user.clear(screen.getByLabelText(/oauth issuer url/i))
    await user.type(screen.getByLabelText(/oauth issuer url/i), 'https://spend.example')
    await user.clear(screen.getByLabelText(/frontend redirect uri/i))
    await user.type(screen.getByLabelText(/frontend redirect uri/i), 'https://spend.example/auth/callback')
    // Enable passkey first so its fields are visible
    await user.click(screen.getByRole('button', { name: /^passkey$/i }))
    await user.type(await screen.findByLabelText(/^rp id$/i), 'spend.example')
    await user.type(screen.getByLabelText(/^origins$/i), 'https://spend.example')
    // Email is enabled by default so SMTP fields are already visible
    await user.type(screen.getByLabelText(/smtp host/i), 'smtp.example.com')
    await user.type(screen.getByLabelText(/smtp from/i), 'noreply@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Register next' })).toBeInTheDocument()
  })

  it('shows Google redirect reminder before continuing', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/oauth-setup', <AuthConfigStep />, '/setup/register', 'Register next')

    await user.click(screen.getByRole('button', { name: /^google$/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: /before you continue/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /go back/i }))
    expect(screen.queryByRole('heading', { name: /before you continue/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(await screen.findByRole('button', { name: /yes, i've added it/i }))

    expect(await screen.findByRole('heading', { name: 'Register next' })).toBeInTheDocument()
  })

  it('routes OAuth security choice into provider config', async () => {
    const user = userEvent.setup()
    renderSetupWithAuth('/setup/security', <SecurityChoiceStep />, '/setup/oauth-setup', 'Auth config next', authContextWithoutMasterPassword)

    await user.click(screen.getByRole('button', { name: /oauth/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Auth config next' })).toBeInTheDocument()
  })

  it('routes password security choice into password setup', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/security', <SecurityChoiceStep />, '/setup/password-setup', 'Password setup next')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Password setup next' })).toBeInTheDocument()
  })

  it('continues from password setup to OAuth when both are selected', async () => {
    const user = userEvent.setup()
    renderSetupFlow(
      '/setup/security',
      <>
        <Route element={<SecurityChoiceStep />} path="/setup/security" />
        <Route element={<PasswordSetupStep />} path="/setup/password-setup" />
        <Route element={<h1>Auth config next</h1>} path="/setup/oauth-setup" />
      </>,
    )

    await user.click(screen.getByRole('button', { name: /oauth/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(await screen.findByLabelText(/^master password$/i), 'master-password')
    await user.type(screen.getByLabelText(/^confirm master password$/i), 'master-password')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Auth config next' })).toBeInTheDocument()
  })

  it('continues from password-only setup to owners', async () => {
    const user = userEvent.setup()
    renderSetupWithAuth('/setup/password-setup', <PasswordSetupStep />, '/setup/owners', 'Owners next', authContextWithoutMasterPassword)

    await user.type(screen.getByLabelText(/^master password$/i), 'master-password')
    await user.type(screen.getByLabelText(/^confirm master password$/i), 'master-password')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Owners next' })).toBeInTheDocument()
  })

  it('skips from welcome to completion', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/welcome', <WelcomeStep />, '/setup/complete', 'Complete next')

    await user.click(screen.getByRole('button', { name: /skip setup/i }))

    expect(await screen.findByRole('heading', { name: 'Complete next' })).toBeInTheDocument()
  })

  it('requires at least one OAuth provider', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/oauth-setup', <AuthConfigStep />, '/setup/register', 'Register next')

    // Email is the only provider enabled by default; disable it to leave none selected
    await user.click(screen.getByRole('button', { name: /^email$/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/enable at least one sign-in method/i)).toBeInTheDocument()
  })

  it('registers an admin account and advances to owners', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/register', <RegisterAccountStep />, '/setup/owners', 'Owners next')

    await user.type(screen.getByLabelText(/admin email address/i), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Owners next' })).toBeInTheDocument()
  })

  it('requires passkey registration for passkey-only setup', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} })
    renderSetupFlow(
      '/setup/oauth-setup',
      <>
        <Route element={<AuthConfigStep />} path="/setup/oauth-setup" />
        <Route element={<RegisterAccountStep />} path="/setup/register" />
        <Route element={<h1>Owners next</h1>} path="/setup/owners" />
      </>,
    )

    await user.click(screen.getByRole('button', { name: /^passkey$/i }))
    await user.click(screen.getByRole('button', { name: /^email$/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(await screen.findByLabelText(/admin email address/i), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/Passkeys are the only sign-in method/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /register passkey/i }))
    await waitFor(() => expect(runPasskeyRegistration).toHaveBeenCalledWith('My passkey', 'owner@example.com'))
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByRole('heading', { name: 'Owners next' })).toBeInTheDocument()
  })

  it('adds owners and requires at least one before advancing to connections', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/owners', <OwnersStep />, '/setup/connections', 'Connections next')

    expect(await screen.findByText('alex')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete alex/i }))
    await user.type(screen.getByPlaceholderText(/owner name/i), 'New Owner')
    await user.click(screen.getByRole('button', { name: /add/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connections next' })).toBeInTheDocument())
  })

  it('marks setup complete and surfaces finalization errors', async () => {
    const user = userEvent.setup()
    const updateConfiguration = vi.fn()
    server.use(
      graphql.link('/query').mutation('UpdateConfiguration', ({ variables }) => {
        updateConfiguration(variables.input)
        return HttpResponse.json({ errors: [{ message: 'finish failed' }] })
      }),
    )
    renderSetup('/setup/complete', <CompleteStep />, '/', 'Home')

    await user.click(screen.getByRole('button', { name: /finish/i }))

    expect(await screen.findByText(/finish failed/)).toBeInTheDocument()
    expect(updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({ setupComplete: true }))
  })

  it('waits for updated auth config before redirecting setup auth users to accounts', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } })
    let authConfigRequests = 0
    const updateConfiguration = captureMutation('UpdateConfiguration', { updateConfiguration: { __typename: 'UpdateConfigurationPayload', configuration: setupConfiguration } })
    server.use(
      http.get('/auth/config', () => {
        authConfigRequests += 1
        return HttpResponse.json({ master_password_status: 'ENABLED', email_auth_enabled: false, google_auth_enabled: false, webauthn_enabled: false, disable_all_auth: false, setup_complete: true, scopes: [] })
      }),
    )

    try {
      renderWithProviders(
        <SetupContext.Provider value={{ ...initialSetupState, passwordEnabled: true, masterPassword: 'master-password', updateSetup: vi.fn() }}>
          <CompleteStep />
        </SetupContext.Provider>,
        { initialEntries: ['/setup/complete'], withGraphql: true },
      )

      await user.click(screen.getByRole('button', { name: /finish/i }))

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/accounts'))
      expect(updateConfiguration.input).toMatchObject({ setupComplete: true, authorization: { masterPassword: 'master-password' } })
      expect(authConfigRequests).toBeGreaterThan(0)
      expect(document.cookie).toContain(`st_post_login=${encodeURIComponent('/accounts')}`)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
      document.cookie = 'st_post_login=; max-age=0; path=/'
    }
  })

  it('shows error for empty master password', async () => {
    const user = userEvent.setup()
    renderSetupWithAuth('/setup/password-setup', <PasswordSetupStep />, '/setup/connections', 'Connections next', authContextWithoutMasterPassword)

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/enter a master password/i)).toBeInTheDocument()
  })

  it('shows error for mismatched master passwords', async () => {
    const user = userEvent.setup()
    renderSetupWithAuth('/setup/password-setup', <PasswordSetupStep />, '/setup/connections', 'Connections next', authContextWithoutMasterPassword)

    await user.type(screen.getByLabelText(/^master password$/i), 'password1')
    await user.type(screen.getByLabelText(/^confirm master password$/i), 'password2')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
  })

  it('goes back from password setup to security choice', async () => {
    const user = userEvent.setup()
    renderSetupWithAuth('/setup/password-setup', <PasswordSetupStep />, '/setup/security', 'Security next', authContextWithoutMasterPassword)

    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(await screen.findByRole('heading', { name: 'Security next' })).toBeInTheDocument()
  })

  it('skips connections setup and advances to completion', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/connections', <ConnectionsStep />, '/setup/complete', 'Complete next')

    await user.click(screen.getByRole('button', { name: /skip for now/i }))

    expect(await screen.findByRole('heading', { name: 'Complete next' })).toBeInTheDocument()
  })

  it('redirects connections setup to owners when no owner exists', async () => {
    mockQuery('Owners', { owners: { __typename: 'OwnerList', items: [] } })
    renderSetup('/setup/connections', <ConnectionsStep />, '/setup/owners', 'Owners next')

    expect(await screen.findByRole('heading', { name: 'Owners next' })).toBeInTheDocument()
  })

  it('continues from connections setup to completion', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/connections', <ConnectionsStep />, '/setup/complete', 'Complete next')

    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByRole('heading', { name: 'Complete next' })).toBeInTheDocument()
  })

  it('switches between Plaid and SimpleFIN tabs in connections setup', async () => {
    const user = userEvent.setup()
    renderSetup('/setup/connections', <ConnectionsStep />, '/setup/complete', 'Complete next')

    expect(screen.getByRole('tab', { name: /plaid/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /simplefin/i })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /simplefin/i }))
    expect(screen.getByRole('tab', { name: /simplefin/i })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: /plaid/i }))
    expect(screen.getByRole('tab', { name: /plaid/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a spinner while saving SimpleFIN in connections setup', async () => {
    const user = userEvent.setup()
    let resolveMutation: () => void = () => undefined
    server.use(
      graphql.link('/query').mutation('CreateSimpleFinAccessToken', async () => {
        await new Promise<void>((resolve) => { resolveMutation = resolve })
        return HttpResponse.json({ data: { createSimpleFinAccessToken: { __typename: 'CreateSimpleFinAccessTokenPayload', accessToken: null, connections: [], accounts: [] } } })
      }),
    )
    renderSetup('/setup/connections', <ConnectionsStep />, '/setup/complete', 'Complete next')

    await user.click(screen.getByRole('tab', { name: /simplefin/i }))
    await user.type(screen.getByLabelText(/setup token/i), 'setup-token')
    await user.selectOptions(await screen.findByLabelText(/owner/i), 'owner-1')
    await user.click(screen.getByRole('button', { name: /save token/i }))

    expect(await screen.findByText(/linking connection/i)).toBeInTheDocument()
    resolveMutation()
  })

  it('shows error when admin user registration fails', async () => {
    const user = userEvent.setup()
    mockGraphqlError('AddUser', 'email already exists', { kind: 'mutation' })
    renderSetup('/setup/register', <RegisterAccountStep />, '/setup/owners', 'Owners next')

    await user.type(screen.getByLabelText(/admin email address/i), 'existing@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/email already exists/i)).toBeInTheDocument()
  })
})
