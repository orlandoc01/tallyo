import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import { CashFlowFilterPanel } from './CashFlowFilterPanel'
import { cashFlowDatePresets } from './cashFlowStats'

const now = new Date(2026, 5, 21)
const presets = cashFlowDatePresets()

function renderPanel(ownerIds: string[]) {
  const onOwnerChange = vi.fn()
  renderWithProviders(
    <CashFlowFilterPanel dateFiltered={false} now={now} ownerIds={ownerIds} presets={presets} range={presets[0].range(now)} onClear={vi.fn()} onOwnerChange={onOwnerChange} onRangeChange={vi.fn()} onResetRange={vi.fn()} />,
    { auth: { hideOwners: false }, withGraphql: true },
  )
  return onOwnerChange
}

describe('CashFlowFilterPanel owner chip', () => {
  it('selects an owner from the Owner dropdown', async () => {
    const onOwnerChange = renderPanel([])
    await userEvent.click(await screen.findByRole('button', { name: 'Owner' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'sam' }))
    expect(onOwnerChange).toHaveBeenCalledWith(['owner-2'])
  })

  it('shows the selected owner as an active pill and clears it', async () => {
    const onOwnerChange = renderPanel(['owner-2'])
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Owner filter: sam' }))
    expect(onOwnerChange).toHaveBeenCalledWith([])
  })
})
