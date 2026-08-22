import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { owners } from '../../mocks/fixtures'
import { captureMutation, mockGraphqlError, mockQuery } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { OwnersSection } from './OwnersSection'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OwnersSection', () => {
  it('lists existing owners', async () => {
    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('alex')).toBeInTheDocument()
    expect(screen.getByText('sam')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete alex/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete sam/i })).toBeInTheDocument()
  })

  it('shows empty state when no owners exist', async () => {
    mockQuery('Owners', { owners: { __typename: 'OwnerList', items: [] } })

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('No owners yet.')).toBeInTheDocument()
  })

  it('adds a new owner', async () => {
    const user = userEvent.setup()

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    await user.type(screen.getByPlaceholderText(/new owner name/i), 'Lena')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/new owner name/i)).toHaveValue('')
    })
  })

  it('shows error when add fails', async () => {
    const user = userEvent.setup()

    mockGraphqlError('CreateOwner', 'Name already taken', { kind: 'mutation', status: 400 })

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    await user.type(screen.getByPlaceholderText(/new owner name/i), 'Lena')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(await screen.findByText(/name already taken/i)).toBeInTheDocument()
  })

  it('adds owner on Enter key', async () => {
    const user = userEvent.setup()

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    await user.type(screen.getByPlaceholderText(/new owner name/i), 'Lena{Enter}')

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/new owner name/i)).toHaveValue('')
    })
  })

  it('deletes an owner', async () => {
    const user = userEvent.setup()
    const deleteOwner = captureMutation('DeleteOwner', { deleteOwner: true })

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    await user.click(screen.getByRole('button', { name: /delete alex/i }))

    await waitFor(() => {
      expect(deleteOwner.variables?.id).toBe(owners[0].id)
    })
  })

  it('shows inline error when delete fails', async () => {
    const user = userEvent.setup()

    mockGraphqlError('DeleteOwner', 'Owner still in use', { kind: 'mutation', status: 400 })

    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    await user.click(screen.getByRole('button', { name: /delete alex/i }))

    expect(await screen.findByText(/owner still in use/i)).toBeInTheDocument()
  })

  it('disables Add button when input is empty', async () => {
    render(<OwnersSection canWriteOwners />, { wrapper: GraphqlTestProvider })

    await screen.findByText('alex')

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
  })

  it('lists owners without write controls when read-only', async () => {
    render(<OwnersSection canWriteOwners={false} />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('alex')).toBeInTheDocument()
    expect(screen.getByText('sam')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete alex/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/new owner name/i)).not.toBeInTheDocument()
  })
})
