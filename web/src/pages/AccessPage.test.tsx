import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../hooks/usePermissions'
import { allowAllPermissionResult } from '../test/permissions'
import { mockGraphqlError } from '../test/msw'
import { GraphqlTestProvider } from '../test/renderWithProviders'
import { AccessPage } from './AccessPage'

vi.mock('../hooks/usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

const ROLE_ORDER = ['Writer', 'Read only', 'Spending tracker', 'Cashflow tracker', 'Net worth tracker', 'Portfolio tracker', 'Admin']

describe('AccessPage', () => {
  afterEach(() => {
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  })

  it('renders the user list', async () => {
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
  })

  it('shows all role options in selects', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getByText('Writer'))
    const select = screen.getByRole('combobox')
    const options = within(select).getAllByRole('option')
    expect(options).toHaveLength(7)
    options.forEach((opt, i) => {
      expect(opt).toHaveTextContent(ROLE_ORDER[i])
    })
  })

  it('shows RoleSelect when clicking a badge with canWrite', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByText('Writer'))
    const select = screen.getByRole('combobox')
    expect(select).not.toBeDisabled()
  })

  it('shows RoleBadge for all users', async () => {
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    expect(screen.getByText('Writer')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows RoleBadge for all users when not writable', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      hasScope: () => false,
    })

    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Writer')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('calls updateUser mutation on role change', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getByText('Writer'))
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'READONLY')

    await waitFor(() => {
      expect(screen.getByText('✓')).toBeInTheDocument()
    })
  })

  it('shows error message on mutation failure', async () => {
    mockGraphqlError('UpdateUser', 'cannot modify an admin user', { kind: 'mutation', status: 200 })

    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getByText('Writer'))
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'READONLY')

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('cannot modify an admin user'))).toBeInTheDocument()
    })
  })

  it('shows invite form with role select', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getByText('+ Add user'))

    const formSelect = screen.getByLabelText('Role')
    expect(formSelect).toBeInTheDocument()
    const options = within(formSelect).getAllByRole('option')
    expect(options).toHaveLength(7)
    options.forEach((opt, i) => {
      expect(opt).toHaveTextContent(ROLE_ORDER[i])
    })
  })

  it('adds a user via invite form', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getByText('+ Add user'))

    await user.type(screen.getByLabelText('Email address'), 'new@example.com')
    await user.click(screen.getByText('Invite'))

    await waitFor(() => {
      expect(screen.queryByText('Sending invite...')).not.toBeInTheDocument()
    })
  })

  it('generates an invite link on demand', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    await user.click(screen.getAllByRole('button', { name: /invite link/i })[0])

    expect(await screen.findByText('One-time invite link')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/token=invite/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('One-time invite link')).not.toBeInTheDocument()
  })

  it('removes a user', async () => {
    const user = userEvent.setup()
    render(<AccessPage />, { wrapper: GraphqlTestProvider })
    await screen.findByRole('columnheader', { name: 'Email' })

    const removeButtons = screen.getAllByText('Remove')
    await user.click(removeButtons[0])
  })

  it('shows loading spinner initially', () => {
    render(<AccessPage />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
