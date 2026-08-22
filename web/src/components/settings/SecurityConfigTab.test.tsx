import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMutation } from 'urql'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePermissions } from '../../hooks/usePermissions'
import { configurationFixture } from '../../mocks/fixtures'
import { itHandlesConfigTabQueryStates, mockConfiguration, mockSettingsPermissions } from '../../test/permissions'
import { SecurityConfigTab } from './SecurityConfigTab'

vi.mock('../../hooks/useConfiguration', () => ({
  useConfiguration: vi.fn(),
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ masterPasswordStatus: 'ENABLED' }),
}))

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({ useMutation: vi.fn() }))

const configuration = { ...configurationFixture, mcp: { ...configurationFixture.mcp, dynamicRedirectHosts: [] } }
const mockPermissions = (canReadSettings: boolean) => mockSettingsPermissions(canReadSettings, usePermissions, useMutation)

function mockMutation(execute: ReturnType<typeof vi.fn>) {
  vi.mocked(useMutation).mockReturnValue([{ fetching: false, error: null }, execute] as never)
}

function sectionForm(title: string) {
  const form = screen.getByText(title).closest('form')
  if (!form) throw new Error(`${title} form not found`)
  return form
}

describe('SecurityConfigTab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  itHandlesConfigTabQueryStates(() => <SecurityConfigTab />, 'failed', usePermissions, useMutation)

  it('renders sectioned configuration values', () => {
    mockPermissions(true)
    mockConfiguration({ configuration })
    render(<SecurityConfigTab />)

    expect(screen.getByText('Authorization')).toBeTruthy()
    expect(screen.getByText('Passkeys')).toBeTruthy()
    expect(screen.getByText('Trusted Proxies')).toBeTruthy()
    expect(screen.getByText('Google Sign-In')).toBeTruthy()
    expect(screen.getByText('Email Sign-In')).toBeTruthy()
    expect(screen.getByLabelText('Issuer URL')).toBeTruthy()
    expect(screen.getByDisplayValue('https://spend.example/auth/callback')).toBeTruthy()
    expect(screen.getByDisplayValue('10.0.0.0/24')).toBeTruthy()
    expect(screen.getByLabelText('Dev CORS allowed origins')).toHaveAttribute('placeholder', 'Optional')
    expect(screen.getByLabelText('Trusted proxy CIDRs')).toHaveAttribute('placeholder', 'Optional')
    expect(screen.getByLabelText('RP ID')).toHaveAttribute('placeholder', 'Optional')
    expect(screen.getByLabelText('RP origins')).toHaveAttribute('placeholder', 'Optional')
    expect(screen.getByText('Client secret')).toBeTruthy()
    expect(screen.getAllByDisplayValue('********').length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument()
  })

  it('saves only the edited section input', async () => {
    mockPermissions(true)
    const reexecuteQuery = vi.fn()
    const execute = vi.fn().mockResolvedValue({ data: { updateConfiguration: { configuration } } })
    mockMutation(execute)
    mockConfiguration({ configuration, refetch: reexecuteQuery })
    render(<SecurityConfigTab />)

    const googleForm = sectionForm('Google Sign-In')
    fireEvent.change(within(googleForm).getByLabelText('Client ID'), { target: { value: 'new-client-id' } })
    fireEvent.click(within(googleForm).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(execute).toHaveBeenCalled())
    expect(execute).toHaveBeenCalledWith({
      input: {
        googleAuthn: {
          enabled: true,
          googleClientId: 'new-client-id',
          googleClientSecret: '********',
        },
      },
    })
    expect(reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
  })

  it('normalizes comma-separated Passkeys origins', async () => {
    mockPermissions(true)
    const execute = vi.fn().mockResolvedValue({ data: { updateConfiguration: { configuration } } })
    mockMutation(execute)
    mockConfiguration({ configuration })
    render(<SecurityConfigTab />)

    const passkeysForm = sectionForm('Passkeys')
    fireEvent.change(within(passkeysForm).getByLabelText('RP origins'), { target: { value: 'https://a.example, https://b.example' } })
    fireEvent.click(within(passkeysForm).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(execute).toHaveBeenCalled())
    expect(execute.mock.calls[0][0].input.passKeyAuthn.webauthnRpOrigins).toEqual(['https://a.example', 'https://b.example'])
  })

  it('normalizes comma-separated trusted proxy CIDRs', async () => {
    mockPermissions(true)
    const execute = vi.fn().mockResolvedValue({ data: { updateConfiguration: { configuration } } })
    mockMutation(execute)
    mockConfiguration({ configuration })
    render(<SecurityConfigTab />)

    const trustedProxyForm = sectionForm('Trusted Proxies')
    fireEvent.change(within(trustedProxyForm).getByLabelText('Trusted proxy CIDRs'), { target: { value: '10.0.0.0/24, 127.0.0.1' } })
    fireEvent.click(within(trustedProxyForm).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(execute).toHaveBeenCalled())
    expect(execute.mock.calls[0][0].input.security.trustedProxyCidrs).toEqual(['10.0.0.0/24', '127.0.0.1'])
  })

  it('shows save only for the dirty section and clears it when reverted', () => {
    mockPermissions(true)
    mockConfiguration({ configuration })
    render(<SecurityConfigTab />)

    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument()

    const googleForm = sectionForm('Google Sign-In')
    const enabledToggle = within(googleForm).getByRole('switch', { name: 'Enabled' })

    fireEvent.click(enabledToggle)

    expect(within(googleForm).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Enabled*')).toBeTruthy()
    expect(within(googleForm).getByRole('button', { name: 'save' })).toBeTruthy()

    fireEvent.click(enabledToggle)

    expect(within(googleForm).queryByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Enabled*')).toBeNull()
    expect(within(googleForm).queryByRole('button', { name: 'save' })).toBeNull()
  })

  it('confirms via modal and saves authorization with restart polling', async () => {
    mockPermissions(true)
    const reexecuteQuery = vi.fn()
    const execute = vi.fn().mockResolvedValue({ data: { updateConfiguration: { configuration } } })
    mockMutation(execute)
    mockConfiguration({ configuration, refetch: reexecuteQuery })
    render(<SecurityConfigTab />)

    const authorizationForm = sectionForm('Authorization')
    fireEvent.change(within(authorizationForm).getByLabelText('Master password value'), { target: { value: 'new-master-password' } })
    fireEvent.change(within(authorizationForm).getByLabelText('Issuer URL'), { target: { value: 'https://auth.example' } })
    fireEvent.change(within(authorizationForm).getByLabelText('Frontend redirect URIs'), { target: { value: 'https://a.example/callback, https://b.example/callback' } })
    fireEvent.change(within(authorizationForm).getByLabelText('Access token lifetime'), { target: { value: '30m' } })
    fireEvent.change(within(authorizationForm).getByLabelText('Refresh token lifetime'), { target: { value: '240h' } })
    fireEvent.change(within(authorizationForm).getByLabelText('Dev CORS allowed origins'), { target: { value: 'https://dev.example' } })
    fireEvent.click(within(authorizationForm).getByRole('button', { name: 'save' }))

    expect(screen.getByText('Restart required')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save and restart' }))

    await waitFor(() => expect(execute).toHaveBeenCalled())
    expect(execute.mock.calls[0][0].input.authorization).toMatchObject({
      masterPassword: 'new-master-password',
      disableAllAuth: false,
      oauthIssuerUrl: 'https://auth.example',
      frontendRedirectUris: ['https://a.example/callback', 'https://b.example/callback'],
      accessTokenLifetime: '30m',
      refreshTokenLifetime: '240h',
      devCorsAllowedOrigins: ['https://dev.example'],
    })
    await waitFor(() => expect(reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' }))
  })
})
