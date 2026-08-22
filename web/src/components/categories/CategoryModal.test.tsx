import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories, categoryGroups } from '../../mocks/fixtures'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { itHandlesCreateModal } from '../../test/createModal'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CategoryModal } from './CategoryModal'

describe('CategoryModal', () => {
  it('renders in create mode', () => {
    render(
      <CategoryModal
        category={null}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    expect(screen.getByRole('dialog', { name: /new category/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('renders in edit mode with populated fields', () => {
    render(
      <CategoryModal
        category={categories[0]}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    expect(screen.getByRole('dialog', { name: /edit category/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Groceries')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
  })

  it('disables delete for uncategorized category', () => {
    render(
      <CategoryModal
        category={{ ...categories[0], id: '0' }}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('shows confirm delete panel when delete is clicked', async () => {
    const user = userEvent.setup()
    render(
      <CategoryModal
        category={categories[0]}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()
    // Two cancel buttons: confirm panel cancel and main form cancel
    expect(screen.getAllByRole('button', { name: /cancel/i }).length).toBeGreaterThanOrEqual(2)
  })

  itHandlesCreateModal(({ onClose, onSaved }) => render(<CategoryModal category={null} groups={categoryGroups} onClose={onClose} onDeleted={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider }), '🛒', 'Shopping')

  it('submits updated category fields', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const updateCategory = captureMutation('UpdateCategory', { updateCategory: { __typename: 'UpdateCategoryPayload', category: { ...categories[0], name: 'Fresh Groceries' } } })
    render(
      <CategoryModal
        category={categories[0]}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={onSaved}
      />,
      { wrapper: GraphqlTestProvider },
    )
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Fresh Groceries')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(updateCategory.input).toMatchObject({ id: categories[0].id, name: 'Fresh Groceries' })
  })

  it('shows kind label based on selected group', () => {
    render(
      <CategoryModal
        category={null}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    expect(screen.getByText(/Kind: EXPENSE/)).toBeInTheDocument()
  })

  it('calls onDeleted after confirming deletion', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    render(
      <CategoryModal
        category={categories[0]}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={onDeleted}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  })

  it('shows error when delete mutation fails', async () => {
    const user = userEvent.setup()
    mockGraphqlError('DeleteCategory', 'cannot delete category with 3 transactions', { kind: 'mutation' })
    render(
      <CategoryModal
        category={categories[0]}
        groups={categoryGroups}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        onSaved={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))
    await screen.findByText(/cannot delete category/)
  })
})
