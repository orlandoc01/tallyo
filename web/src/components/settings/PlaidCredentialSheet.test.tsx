import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { plaidCredentials } from '../../mocks/fixtures'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { PlaidTab } from './PlaidTab'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

describe('PlaidCredentialSheet', () => {
  it('stores a new credential from the sheet rows', async () => {
    const user = userEvent.setup()
    const createCredential = captureMutation<{ clientId: string; secret: string; environment: string; label: string | null }>('CreatePlaidCredential', {
      createPlaidCredential: { __typename: 'CreatePlaidCredentialPayload', credential: { ...plaidCredentials[0], id: 'cred-new', clientId: 'new-client', label: 'New label', environment: 'PRODUCTION' } },
    })
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /store credentials/i }))
    const sheet = screen.getByRole('dialog', { name: 'Store credentials' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(within(sheet).getByRole('button', { name: /^client id/i }))
    await user.type(within(sheet).getByRole('textbox', { name: 'Client ID' }), 'new-client')
    await user.click(within(sheet).getByRole('button', { name: /^client secret/i }))
    const secret = within(sheet).getByLabelText('Client secret')
    expect(secret).toHaveAttribute('type', 'password')
    await user.type(secret, 'new-secret')
    await user.click(within(sheet).getByRole('button', { name: /^label/i }))
    await user.type(within(sheet).getByRole('textbox', { name: 'Label' }), 'New label')
    await user.click(within(sheet).getByRole('button', { name: /^environment/i }))
    await user.click(within(sheet).getByRole('radio', { name: 'production' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createCredential.input).toEqual({ clientId: 'new-client', secret: 'new-secret', environment: 'PRODUCTION', label: 'New label' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rotates and deletes an existing credential', async () => {
    const user = userEvent.setup()
    const updateCredential = captureMutation<{ id: string; secret: string; environment: string }>('UpdatePlaidCredential', {
      updatePlaidCredential: { __typename: 'UpdatePlaidCredentialPayload', credential: plaidCredentials[0] },
    })
    const deleteCredential = captureMutation<{ id: string }>('DeletePlaidCredential', { deletePlaidCredential: { __typename: 'DeletePlaidCredentialPayload', success: true } })
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    await screen.findByText('Primary')
    await user.click(screen.getAllByRole('button', { name: /primary/i })[1])
    const sheet = screen.getByRole('dialog', { name: 'Rotate credential' })
    expect(within(sheet).queryByRole('button', { name: /^label/i })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: /^client id/i }))
    expect(within(sheet).getByRole('textbox', { name: 'Client ID' })).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: /^client secret/i }))
    await user.type(within(sheet).getByLabelText('Client secret'), 'rotated-secret')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateCredential.input).toEqual({ id: plaidCredentials[0].id, secret: 'rotated-secret', environment: 'SANDBOX' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: /primary/i })[1])
    await user.click(screen.getByRole('button', { name: 'Delete credential' }))
    expect(deleteCredential.called).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Tap again to confirm' }))
    await waitFor(() => expect(deleteCredential.input).toEqual({ id: plaidCredentials[0].id }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the mutation error inside the sheet', async () => {
    const user = userEvent.setup()
    mockGraphqlError('CreatePlaidCredential', 'client id already stored', { kind: 'mutation' })
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /store credentials/i }))
    const sheet = screen.getByRole('dialog', { name: 'Store credentials' })
    await user.click(within(sheet).getByRole('button', { name: /^client id/i }))
    await user.type(within(sheet).getByRole('textbox', { name: 'Client ID' }), 'dupe')
    await user.click(within(sheet).getByRole('button', { name: /^client secret/i }))
    await user.type(within(sheet).getByLabelText('Client secret'), 'secret')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(sheet).findByText(/client id already stored/)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Store credentials' })).toBeInTheDocument()
  })
})
