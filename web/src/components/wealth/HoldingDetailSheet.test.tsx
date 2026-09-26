import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClassifierBreakdown, HoldingRollup } from '../../types/graphql'
import { accounts, assets } from '../../mocks/fixtures'
import { HoldingDetailSheet } from './HoldingDetailSheet'

const holding: HoldingRollup = {
  __typename: 'HoldingRollup',
  asset: assets[1],
  totalQuantity: 12,
  valueUSD: 3_000,
  percentOfClassifier: 50,
  holdings: [{ __typename: 'Holding', assetId: assets[1].id, asset: assets[1], accountId: accounts[0].id, account: accounts[0], quantity: 12, valueUSD: 3_000, manual: false }],
}
const classifier: ClassifierBreakdown = { __typename: 'ClassifierBreakdown', classifier: 'PUBLIC', label: 'Public equities', valueUSD: 6_000, percentOfAssets: 60, assetCount: 2, holdings: [holding] }

describe('HoldingDetailSheet', () => {
  it('renders the holding hero and static rows and routes the actions', async () => {
    const user = userEvent.setup()
    const onEditAsset = vi.fn()
    const onViewAccount = vi.fn()
    const onClose = vi.fn()
    render(<HoldingDetailSheet classifier={classifier} holding={holding} onClose={onClose} onEditAsset={onEditAsset} onViewAccount={onViewAccount} totalAssetsUSD={10_000} />)

    const sheet = screen.getByRole('dialog', { name: 'Holding' })
    expect(within(sheet).getByRole('region', { name: `Details for ${assets[1].name}` })).toBeInTheDocument()
    expect(within(sheet).getByText(`${accounts[0].name} · 12 shares`)).toBeInTheDocument()
    expect(within(sheet).getByText('$3,000.00')).toBeInTheDocument()
    expect(within(sheet).getByText('Public equities')).toBeInTheDocument()
    expect(within(sheet).getByText('30.00% of assets')).toBeInTheDocument()
    expect(within(sheet).getByText('American Express')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Edit asset' }))
    expect(onEditAsset).toHaveBeenCalledWith(holding)
    await user.click(within(sheet).getByRole('button', { name: 'View account' }))
    expect(onViewAccount).toHaveBeenCalledWith(holding)
    await user.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('hides the account action without a backing account', () => {
    render(<HoldingDetailSheet classifier={null} holding={{ ...holding, holdings: [] }} onClose={vi.fn()} onEditAsset={vi.fn()} onViewAccount={vi.fn()} totalAssetsUSD={0} />)

    expect(screen.queryByRole('button', { name: 'View account' })).not.toBeInTheDocument()
    expect(screen.getByText('12 shares')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
