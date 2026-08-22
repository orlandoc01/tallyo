import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { ConnectionsTab } from './ConnectionsTab'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

describe('ConnectionsTab', () => {
  it('lists SimpleFIN access tokens and connections', async () => {
    const user = userEvent.setup()
    render(<ConnectionsTab />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('tab', { name: /simplefin/i }))
    expect(await screen.findByText('SimpleFIN Bridge')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand simplefin bridge/i }))
    expect(screen.getByText(/https:\/\/www\.chase\.com/)).toBeInTheDocument()
    expect(screen.getByText(/1 account/i)).toBeInTheDocument()
  })

  it('creates a SimpleFIN access token from the shared connection modal', async () => {
    const user = userEvent.setup()
    render(<ConnectionsTab />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('tab', { name: /simplefin/i }))
    await user.click(await screen.findByRole('button', { name: /create access token/i }))

    const dialog = screen.getByRole('dialog', { name: /link connection/i })
    expect(within(dialog).getByRole('tab', { name: /simplefin/i })).toHaveAttribute('aria-selected', 'true')
    await user.type(within(dialog).getByLabelText(/setup token/i), 'c2V0dXAtdG9rZW4=')
    await user.type(within(dialog).getByLabelText(/label/i), 'Bridge token')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(within(dialog).getByLabelText(/owner/i), 'owner-2')
    await user.click(within(dialog).getByRole('button', { name: /^link$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/Created SimpleFIN token with 1 connection/i)).toBeInTheDocument()
  })
})
