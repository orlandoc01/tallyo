import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categoryGroups } from '../../mocks/fixtures'
import { itHandlesCreateModal } from '../../test/createModal'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { GroupModal } from './GroupModal'

describe('GroupModal', () => {
  it('renders in create mode with kind selector', () => {
    render(<GroupModal group={null} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })
    expect(screen.getByRole('dialog', { name: /new group/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/kind/i)).toBeInTheDocument()
  })

  it('renders in edit mode with read-only kind badge', () => {
    render(<GroupModal group={categoryGroups[0]} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })
    expect(screen.getByRole('dialog', { name: /edit group/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/kind/i)).not.toBeInTheDocument()
    expect(screen.getByText('Kind cannot be changed after creation.')).toBeInTheDocument()
  })

  itHandlesCreateModal(({ onClose, onSaved }) => render(<GroupModal group={null} onClose={onClose} onSaved={onSaved} />, { wrapper: GraphqlTestProvider }), '🏠', 'Housing')

  it('calls onSaved after successful edit', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<GroupModal group={categoryGroups[0]} onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Food & Dining')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
