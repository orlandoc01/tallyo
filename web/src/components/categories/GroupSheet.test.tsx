import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categoryGroups } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { GroupModal } from './GroupModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('GroupSheet', () => {
  it('renders the create sheet with emoji, name and kind rows', () => {
    render(<GroupModal group={null} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'New group' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^emoji/i })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^name/i })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^kind/i })).toHaveTextContent('Expense')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('creates a group with a picked kind and calls onSaved', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const createGroup = captureMutation<{ name: string; emoji: string; kind: string }>('CreateCategoryGroup', {
      createCategoryGroup: { __typename: 'CreateCategoryGroupPayload', group: { ...categoryGroups[0], id: '99', name: 'Housing', emoji: '🏠', kind: 'INCOME' } },
    })
    render(<GroupModal group={null} onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /^emoji/i }))
    await user.type(screen.getByRole('textbox', { name: 'Emoji' }), '🏠')
    await user.click(screen.getByRole('button', { name: /^name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Housing')
    await user.click(screen.getByRole('button', { name: /^kind/i }))
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    expect(screen.getByRole('button', { name: /^kind/i })).toHaveTextContent('Income')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createGroup.input).toEqual({ name: 'Housing', emoji: '🏠', kind: 'INCOME' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('shows a static kind badge when editing and saves the rename', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const updateGroup = captureMutation<{ id: string; name: string; emoji: string }>('UpdateCategoryGroup', {
      updateCategoryGroup: { __typename: 'UpdateCategoryGroupPayload', group: { ...categoryGroups[0], name: 'Food & Dining' } },
    })
    render(<GroupModal group={categoryGroups[0]} onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('dialog', { name: 'Edit group' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^kind/i })).not.toBeInTheDocument()
    expect(screen.getByText('EXPENSE')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^name/i }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Food & Dining')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateGroup.input).toEqual({ id: '1', name: 'Food & Dining', emoji: '🍽️' }))
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
