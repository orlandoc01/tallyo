import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { PlaidTab } from './PlaidTab'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

describe('PlaidTab', () => {
  it('renders credentials and expands Plaid items', async () => {
    const user = userEvent.setup()
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('Primary')).toBeInTheDocument()
    expect(screen.getByText('Overflow')).toBeInTheDocument()
    expect(screen.queryByText('client-primary')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand primary/i }))
    expect(screen.getByText('item-1')).toBeInTheDocument()
    expect(screen.getByText('American Express')).toBeInTheDocument()
  })

  it('stores a new credential', async () => {
    const user = userEvent.setup()
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /store credentials/i }))
    await user.type(screen.getByLabelText(/client id/i), 'new-client')
    await user.type(screen.getByLabelText(/client secret/i), 'new-secret')
    await user.type(screen.getByLabelText(/label/i), 'New label')
    await user.click(screen.getByRole('button', { name: /production/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rotates and deletes an existing credential', async () => {
    const user = userEvent.setup()
    render(<PlaidTab />, { wrapper: GraphqlTestProvider })

    await screen.findByText('Primary')
    await user.click(screen.getAllByRole('button', { name: /primary/i })[1])
    expect(screen.getByLabelText(/client id/i)).toBeDisabled()
    await user.type(screen.getByLabelText(/client secret/i), 'rotated-secret')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: /primary/i })[1])
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
