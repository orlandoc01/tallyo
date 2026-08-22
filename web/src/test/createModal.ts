import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

type Callbacks = { onClose: () => void; onSaved: () => void }

export function itHandlesCreateModal(renderModal: (callbacks: Callbacks) => void, emoji: string, name: string) {
  it('calls onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose, onSaved: vi.fn() })
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSaved after successful create', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    renderModal({ onClose: vi.fn(), onSaved })
    await user.type(screen.getByLabelText(/emoji/i), emoji)
    await user.type(screen.getByLabelText(/name/i), name)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
}
