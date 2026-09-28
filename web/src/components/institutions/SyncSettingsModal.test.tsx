import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { plaidItems } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { SyncSettingsModal } from './SyncSettingsModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('SyncSettingsModal on mobile', () => {
  it('renders the schedule meta and cron rows, then saves the edited cron', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    const item = plaidItems[0]
    const updateConnection = captureMutation<{ connectionId: string; syncCron: string; recurringSyncCron: string }>('UpdateConnection', {
      updateConnection: { __typename: 'UpdateConnectionPayload', connection: { __typename: 'Connection', id: 'conn-1', isActive: true, provider: { ...item, syncCron: '0 7 * * *' } } },
    })
    render(<SyncSettingsModal connectionId="conn-1" item={item} name="American Express" onClose={vi.fn()} onUpdated={onUpdated} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Sync settings' })
    expect(within(sheet).getByText('Next transaction sync')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save settings' })).toBeDisabled()

    await user.click(within(sheet).getByRole('button', { name: /^transaction sync cron/i }))
    const cron = within(sheet).getByRole('textbox', { name: 'Transaction sync cron' })
    expect(cron).toHaveClass('font-mono')
    await user.clear(cron)
    expect(within(sheet).getByRole('button', { name: 'Save settings' })).toBeDisabled()
    await user.type(cron, '0 7 * * *')
    await user.click(within(sheet).getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(updateConnection.input).toEqual({ connectionId: 'conn-1', syncCron: '0 7 * * *', recurringSyncCron: item.recurringSyncCron }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ syncCron: '0 7 * * *' })))
  })
})
