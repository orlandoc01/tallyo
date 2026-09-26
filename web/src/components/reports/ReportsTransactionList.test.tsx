import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categories } from '../../mocks/fixtures'
import { renderWithProviders } from '../../test/renderWithProviders'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ReportsTransactionList } from './ReportsTransactionList'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: vi.fn(() => false) }))

afterEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false)
})

describe('ReportsTransactionList sort control', () => {
  it('cycles the sort on desktop', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    renderWithProviders(<ReportsTransactionList categories={categories} onCategoryUpdated={vi.fn()} onSortChange={onSortChange} sort={{ field: 'DATE', direction: 'DESC' }} transactionFilter={{}} />, { auth: {}, withGraphql: true })

    await user.click(screen.getAllByRole('button', { name: 'Sort: Date new → old' })[0])
    expect(onSortChange).toHaveBeenCalledWith({ field: 'DATE', direction: 'ASC' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a picker sheet on mobile and applies the chosen sort', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    renderWithProviders(<ReportsTransactionList categories={categories} onCategoryUpdated={vi.fn()} onSortChange={onSortChange} sort={{ field: 'DATE', direction: 'DESC' }} transactionFilter={{}} />, { auth: {}, withGraphql: true })

    await user.click(screen.getAllByRole('button', { name: 'Sort: Date new → old' })[0])
    const sheet = screen.getByRole('dialog', { name: 'Sort' })
    expect(within(sheet).getByRole('radio', { name: 'Date new → old' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(sheet).getByRole('radio', { name: 'Amount high → low' }))
    expect(onSortChange).toHaveBeenCalledWith({ field: 'AMOUNT', direction: 'DESC' })
    expect(screen.queryByRole('dialog', { name: 'Sort' })).not.toBeInTheDocument()
  })
})
