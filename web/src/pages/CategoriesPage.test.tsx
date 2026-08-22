import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { categoryGroups } from '../mocks/fixtures'
import { mockGraphqlError, mockMutation, mockQuery } from '../test/msw'
import { allowAllPermissionResult } from '../test/permissions'
import { MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import { CategoriesPage } from './CategoriesPage'
import { usePermissions } from '../hooks/usePermissions'

vi.mock('../hooks/usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

function renderCategoriesPage(withActionsHost = false) {
  return renderWithProviders(<CategoriesPage />, {
    probes: withActionsHost ? <MobileHeaderActionsHost /> : null,
    withGraphql: true,
    withMobileHeader: true,
  })
}

describe('CategoriesPage', () => {
  afterEach(() => {
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
    vi.restoreAllMocks()
  })

  it('renders group names and categories', async () => {
    renderCategoriesPage()

    expect(await screen.findByText('Food')).toBeInTheDocument()
    expect(await screen.findByText('Food')).toBeInTheDocument()
    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    expect(await screen.findByText('Restaurants & Bars')).toBeInTheDocument()
  })

  it('shows New Group button for writers', async () => {
    renderCategoriesPage()

    expect(await screen.findByText('Food')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new group/i })).toBeInTheDocument()
  })

  it('opens group modal when New Group is clicked', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Food')
    await user.click(screen.getByRole('button', { name: /new group/i }))

    expect(screen.getByRole('dialog', { name: /new group/i })).toBeInTheDocument()
  })

  it('opens group modal from the compact mobile header action', async () => {
    const user = userEvent.setup()
    renderCategoriesPage(true)

    await screen.findByText('Food')
    await user.click(within(screen.getByTestId('mobile-header-actions')).getByRole('button', { name: /new group/i }))

    expect(screen.getByRole('dialog', { name: /new group/i })).toBeInTheDocument()
  })

  it('opens category modal when a category is clicked', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Groceries')
    await user.click(screen.getByRole('button', { name: 'Groceries' }))

    expect(screen.getByRole('dialog', { name: /edit category/i })).toBeInTheDocument()
  })

  it('updates a category row from the mutation cache without refetching groups', async () => {
    const user = userEvent.setup()
    let categoryGroupRequests = 0
    server.use(
      graphql.link('/query').query('CategoryGroups', () => {
        categoryGroupRequests += 1
        return HttpResponse.json({ data: { categoryGroups: { __typename: 'CategoryGroupList', items: categoryGroups } } })
      }),
    )
    mockMutation('UpdateCategory', { updateCategory: { __typename: 'UpdateCategoryPayload', category: { ...categoryGroups[0].categories[0], name: 'Fresh Groceries' } } })

    renderCategoriesPage()

    await screen.findByText('Groceries')
    await user.click(screen.getByRole('button', { name: 'Groceries' }))
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Fresh Groceries')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Fresh Groceries' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Groceries' })).not.toBeInTheDocument()
    expect(categoryGroupRequests).toBe(1)
  })

  it('opens add category modal when Add category is clicked', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Food')
    const addButtons = screen.getAllByRole('button', { name: /add category/i })
    await user.click(addButtons[0])

    expect(screen.getByRole('dialog', { name: /new category/i })).toBeInTheDocument()
  })

  it('hides write controls when user is read-only', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      hasScope: () => false,
    })

    renderCategoriesPage()

    await screen.findByText('Food')
    expect(screen.queryByRole('button', { name: /new group/i })).not.toBeInTheDocument()
  })

  it('shows group edit button for writers', async () => {
    renderCategoriesPage()

    await screen.findByText('Food')
    const editButtons = screen.getAllByRole('button', { name: /edit .* group/i })
    expect(editButtons.length).toBeGreaterThan(0)
  })

  it('creates a new group', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Food')
    await user.click(screen.getByRole('button', { name: /new group/i }))

    const dialog = screen.getByRole('dialog', { name: /new group/i })
    const emojiInput = dialog.querySelector<HTMLInputElement>('#group-emoji')!
    const nameInput = dialog.querySelector<HTMLInputElement>('#group-name')!
    await user.type(emojiInput, '🏠')
    await user.type(nameInput, 'Housing')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('deletes an empty group', async () => {
    const user = userEvent.setup()
    mockQuery('CategoryGroups', { categoryGroups: { __typename: 'CategoryGroupList', items: [{ ...categoryGroups[0], categories: [] }] } })

    renderCategoriesPage()

    await screen.findByText('Food')
    const deleteBtn = screen.getByRole('button', { name: /delete food group/i })
    expect(deleteBtn).not.toBeDisabled()
    await user.click(deleteBtn)

    await waitFor(() => expect(screen.queryByText(/cannot delete/i)).not.toBeInTheDocument())
  })

  it('disables delete group button when group has categories', async () => {
    renderCategoriesPage()

    await screen.findByText('Food')
    const deleteBtn = screen.getByRole('button', { name: /delete food group/i })
    expect(deleteBtn).toBeDisabled()
  })

  it('shows delete error when group delete fails', async () => {
    const user = userEvent.setup()
    mockQuery('CategoryGroups', { categoryGroups: { __typename: 'CategoryGroupList', items: [{ ...categoryGroups[0], categories: [] }] } })
    mockGraphqlError('DeleteCategoryGroup', 'Cannot delete group with 1 category', { kind: 'mutation' })

    renderCategoriesPage()

    await screen.findByText('Food')
    const deleteBtn = screen.getByRole('button', { name: /delete food group/i })
    await user.click(deleteBtn)

    expect(await screen.findByText(/Cannot delete group with 1 category/i)).toBeInTheDocument()
  })

  it('opens edit group modal for an existing group', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Food')
    const editBtn = screen.getAllByRole('button', { name: /edit .* group/i })[0]
    await user.click(editBtn)

    expect(screen.getByRole('dialog', { name: /edit group/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Food')).toBeInTheDocument()
  })

  it('closes modal when close button is clicked', async () => {
    const user = userEvent.setup()
    renderCategoriesPage()

    await screen.findByText('Food')
    await user.click(screen.getByRole('button', { name: /new group/i }))
    expect(screen.getByRole('dialog', { name: /new group/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
