import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { SimpleFinTab } from './SimpleFinTab'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

describe('SimpleFinTab', () => {
  it('resets sync for a token', async () => {
    const user = userEvent.setup()
    const resetSync = captureMutation('ResetSimpleFinSync', { resetSimpleFinSync: { __typename: 'SimpleFinAccessToken', id: '1' } })
    render(<SimpleFinTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: 'Reset sync' }))

    await waitFor(() => expect(resetSync.variables).toEqual({ id: '1' }))
    expect(await screen.findByText(/full pull on its next background tick/i)).toBeInTheDocument()
  })

  it('deletes a token only after confirming', async () => {
    const user = userEvent.setup()
    const deleteToken = captureMutation('DeleteSimpleFinAccessToken', { deleteSimpleFinAccessToken: true })
    render(<SimpleFinTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(deleteToken.called).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(deleteToken.variables).toEqual({ id: '1' }))
    expect(await screen.findByText('SimpleFIN access token deleted.')).toBeInTheDocument()
  })
})
