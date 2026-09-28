import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories, categoryGroups } from '../../mocks/fixtures'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CategoryModal } from './CategoryModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

function renderSheet(props: Partial<Parameters<typeof CategoryModal>[0]> = {}) {
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  render(<CategoryModal category={null} groups={categoryGroups} onClose={vi.fn()} onDeleted={onDeleted} onSaved={onSaved} {...props} />, { wrapper: GraphqlTestProvider })
  return { onDeleted, onSaved }
}

describe('CategorySheet', () => {
  it('renders the create sheet without tabs or a delete action', () => {
    renderSheet({ defaultGroupId: '2' })

    const sheet = screen.getByRole('dialog', { name: 'New category' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('tablist')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^group/i })).toHaveTextContent('💵 Income')
    expect(within(sheet).getByText('INCOME')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Delete category' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('creates a category from the rows and picks a group', async () => {
    const user = userEvent.setup()
    const createCategory = captureMutation<{ name: string; emoji: string; groupId: string }>('CreateCategory', {
      createCategory: { __typename: 'CreateCategoryPayload', category: { ...categories[0], id: '77', name: 'Shopping', emoji: '🛒' } },
    })
    const { onSaved } = renderSheet()

    await user.click(screen.getByRole('button', { name: /^emoji/i }))
    await user.type(screen.getByRole('textbox', { name: 'Emoji' }), '🛒')
    await user.click(screen.getByRole('button', { name: /^name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Shopping')
    await user.click(screen.getByRole('button', { name: /^group/i }))
    await user.click(screen.getByRole('radio', { name: 'Lifestyle' }))
    expect(screen.getByRole('button', { name: /^group/i })).toHaveTextContent('✨ Lifestyle')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createCategory.input).toEqual({ name: 'Shopping', emoji: '🛒', groupId: '4' }))
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('switches between the Info and Plaid tabs when editing', async () => {
    const user = userEvent.setup()
    renderSheet({ category: categories[0] })

    expect(screen.getByRole('dialog', { name: 'Edit category' })).toBeInTheDocument()
    const tabs = screen.getByRole('tablist', { name: 'Category sections' })
    expect(within(tabs).getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true')
    await user.click(within(tabs).getByRole('tab', { name: 'Plaid' }))
    expect(screen.queryByRole('button', { name: /^name/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove FOOD_AND_DRINK_GROCERIES' })).toBeInTheDocument()
    await user.click(within(tabs).getByRole('tab', { name: 'Info' }))
    expect(screen.getByRole('button', { name: /^name/i })).toHaveTextContent('Groceries')
  })

  it('deletes the category after a second tap', async () => {
    const user = userEvent.setup()
    const deleteCategory = captureMutation('DeleteCategory', { deleteCategory: { __typename: 'DeleteCategoryPayload', success: true } })
    const { onDeleted } = renderSheet({ category: categories[0] })

    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(deleteCategory.called).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteCategory.variables).toEqual({ id: '1' }))
    expect(onDeleted).toHaveBeenCalledOnce()
  })

  it('keeps the delete action disabled for the uncategorized category and surfaces delete errors', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<CategoryModal category={{ ...categories[0], id: '0' }} groups={categoryGroups} onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })
    expect(screen.getByRole('button', { name: 'Delete category' })).toBeDisabled()
    unmount()

    mockGraphqlError('DeleteCategory', 'cannot delete category with 3 transactions', { kind: 'mutation' })
    renderSheet({ category: categories[0] })
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    await user.click(screen.getByRole('button', { name: 'Tap again to confirm' }))
    expect(await screen.findByText(/cannot delete category/)).toBeInTheDocument()
  })
})
