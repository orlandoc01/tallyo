import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountSnapshots, accounts, assets } from '../../mocks/fixtures'
import type { AccountSnapshot, Holding } from '../../types/graphql'
import type { SnapshotLine } from './accountSnapshotLines'
import { SnapshotExpandedPanel } from './SnapshotExpandedPanel'
import type { useSnapshotEditorResources } from './useSnapshotEditorResources'

type Resources = ReturnType<typeof useSnapshotEditorResources>

function lineToHolding(snapshot: AccountSnapshot, line: SnapshotLine): Holding {
  return { __typename: 'Holding', accountId: snapshot.accountId, account: accounts.find((item) => item.id === snapshot.accountId)!, asset: line.asset, assetId: line.asset.id, manual: line.manual, quantity: line.quantity, valueUSD: line.valueUSD }
}

function stubResources(overrides: Partial<Resources> = {}): Resources {
  return {
    assets: [],
    assetsError: null,
    assetsFetching: false,
    balanceOnly: false,
    canManageManualHoldings: true,
    canReadAssets: true,
    canWriteWealth: true,
    liabilityBalance: false,
    saveLines: vi.fn(async (snapshot: AccountSnapshot, lines: SnapshotLine[]) => ({
      error: null,
      snapshot: { ...snapshot, holdings: lines.map((line) => lineToHolding(snapshot, line)) },
      account: undefined,
    })),
    usdAsset: assets[0],
    ...overrides,
  }
}

function renderPanel(accountId: string, overrides: Partial<Resources> = {}, snapshotOverrides: Partial<AccountSnapshot> = {}) {
  const account = accounts.find((item) => item.id === accountId)!
  const snapshot = { ...accountSnapshots.find((item) => item.accountId === accountId)!, ...snapshotOverrides }
  const resources = stubResources(overrides)
  const onSaved = vi.fn()
  const view = render(<SnapshotExpandedPanel account={account} onSaved={onSaved} onSaveError={vi.fn()} resources={resources} snapshot={snapshot} />)
  const rerenderWith = (next: AccountSnapshot) => view.rerender(<SnapshotExpandedPanel account={account} onSaved={onSaved} onSaveError={vi.fn()} resources={resources} snapshot={next} />)
  return { onSaved, rerenderWith, resources, snapshot }
}

function deferredSaveLines() {
  const pending: Array<() => void> = []
  const saveLines = vi.fn((snapshot: AccountSnapshot, lines: SnapshotLine[]) => new Promise<Awaited<ReturnType<Resources['saveLines']>>>((resolve) => {
    pending.push(() => resolve({ error: null, snapshot: { ...snapshot, holdings: lines.map((line) => lineToHolding(snapshot, line)) }, account: undefined }))
  }))
  return { pending, saveLines }
}

function savedLines(resources: Resources, call = 0): SnapshotLine[] {
  return vi.mocked(resources.saveLines).mock.calls[call][1]
}

describe('SnapshotExpandedPanel', () => {
  afterEach(() => { vi.useRealTimers() })

  it('links quantity and value through the snapshot price', async () => {
    const user = userEvent.setup()
    renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    const quantity = screen.getByLabelText('Quantity for VTI')
    expect(quantity).toHaveValue('4')
    expect(screen.getByLabelText('Value for VTI')).toHaveValue('1000.00')

    await user.clear(quantity)
    await user.type(quantity, '5')
    expect(screen.getByLabelText('Value for VTI')).toHaveValue('1250')

    await user.clear(screen.getByLabelText('Value for VTI'))
    await user.type(screen.getByLabelText('Value for VTI'), '500')
    expect(quantity).toHaveValue('2')
  })

  it('commits on Enter and shows the Saved · Undo header', async () => {
    const user = userEvent.setup()
    const { onSaved, resources } = renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5{Enter}')

    expect(await screen.findByText(/Saved/)).toBeInTheDocument()
    expect(savedLines(resources)[1]).toMatchObject({ quantity: 5, valueUSD: 1250 })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Edit VTI' })).toHaveTextContent('$1,250.00')
  })

  it('skips the mutation when nothing changed', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('button', { name: 'Edit VTI' })).toBeInTheDocument()
    expect(resources.saveLines).not.toHaveBeenCalled()
  })

  it('commits the open line before opening the next one', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    await user.click(screen.getByRole('button', { name: 'Edit US Dollar' }))

    expect(screen.getByLabelText('Value for US Dollar')).toHaveValue('450.00')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit VTI' })).toHaveTextContent('$1,250.00'))
    expect(resources.saveLines).toHaveBeenCalledTimes(1)
    expect(savedLines(resources)[1].valueUSD).toBe(1250)
  })

  it('serializes overlapping saves so the second payload carries the first saved value', async () => {
    const user = userEvent.setup()
    const { pending, saveLines } = deferredSaveLines()
    renderPanel('acct-1', { saveLines })

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    await user.click(screen.getByRole('button', { name: 'Edit US Dollar' }))
    await user.clear(screen.getByLabelText('Value for US Dollar'))
    await user.type(screen.getByLabelText('Value for US Dollar'), '600')
    fireEvent.pointerDown(document.body)

    expect(saveLines).toHaveBeenCalledTimes(1)
    await act(async () => { pending[0]() })
    await waitFor(() => expect(saveLines).toHaveBeenCalledTimes(2))
    expect(saveLines.mock.calls[1][1].map((line) => [line.asset.id, line.valueUSD])).toEqual([['asset-usd', 600], ['asset-vti', 1250]])
    await act(async () => { pending[1]() })
    expect(screen.getByRole('button', { name: 'Edit US Dollar' })).toHaveTextContent('$600.00')
  })

  it('commits the open line when another line is activated by keyboard', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    fireEvent.click(screen.getByRole('button', { name: 'Edit US Dollar' }))

    expect(screen.getByLabelText('Value for US Dollar')).toBeInTheDocument()
    await waitFor(() => expect(resources.saveLines).toHaveBeenCalledTimes(1))
    expect(savedLines(resources)[1].valueUSD).toBe(1250)
  })

  it('edits the synthetic cash line of a linked holdings-less snapshot only with a USD asset', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('acct-1', {}, { holdings: [] })

    await user.click(screen.getByRole('button', { name: 'Edit Cash balance' }))
    const value = screen.getByLabelText('Value for US Dollar')
    expect(value).toHaveValue('1450.00')
    await user.clear(value)
    await user.type(value, '1500{Enter}')

    await waitFor(() => expect(resources.saveLines).toHaveBeenCalledTimes(1))
    expect(savedLines(resources)).toEqual([expect.objectContaining({ quantity: 1500, valueUSD: 1500 })])
    expect(savedLines(resources)[0].asset.id).toBe('asset-usd')

    cleanup()
    renderPanel('acct-1', { usdAsset: undefined }, { holdings: [] })
    expect(screen.getByText('Cash balance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Cash balance' })).not.toBeInTheDocument()
  })

  it('saves cash and value-only holdings from the value field', async () => {
    const user = userEvent.setup()
    const { resources, snapshot } = renderPanel('acct-1')

    await user.click(screen.getByRole('button', { name: 'Edit US Dollar' }))
    expect(screen.queryByLabelText(/^Quantity for/)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Value for US Dollar'))
    await user.type(screen.getByLabelText('Value for US Dollar'), '500{Enter}')
    await waitFor(() => expect(resources.saveLines).toHaveBeenCalledTimes(1))
    expect(savedLines(resources)[0]).toMatchObject({ quantity: 500, valueUSD: 500 })

    cleanup()
    const valueOnly = renderPanel('acct-1', {}, { holdings: [snapshot.holdings![0], { ...snapshot.holdings![1], quantity: null }] })
    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    expect(screen.queryByLabelText(/^Quantity for/)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Value for VTI'))
    await user.type(screen.getByLabelText('Value for VTI'), '1200{Enter}')
    await waitFor(() => expect(valueOnly.resources.saveLines).toHaveBeenCalledTimes(1))
    expect(savedLines(valueOnly.resources)[1]).toMatchObject({ quantity: null, valueUSD: 1200 })
  })

  it('keeps the draft of a second line open when the first save settles', async () => {
    const user = userEvent.setup()
    const { pending, saveLines } = deferredSaveLines()
    renderPanel('acct-1', { saveLines })

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    await user.click(screen.getByRole('button', { name: 'Edit US Dollar' }))
    await act(async () => { pending[0]() })

    expect(screen.getByLabelText('Value for US Dollar')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit VTI' })).toHaveTextContent('$1,250.00')
  })

  it('seeds a re-opened line from the optimistic value while its save is in flight', async () => {
    const user = userEvent.setup()
    const { pending, saveLines } = deferredSaveLines()
    renderPanel('acct-1', { saveLines })

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    await user.click(screen.getByRole('button', { name: 'Edit US Dollar' }))
    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))

    expect(screen.getByLabelText('Quantity for VTI')).toHaveValue('5')
    await act(async () => { pending[0]() })
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('button', { name: 'Edit VTI' })).toHaveTextContent('$1,250.00')
    expect(saveLines).toHaveBeenCalledTimes(1)
  })

  it('recovers the save chain after saveLines rejects', async () => {
    const user = userEvent.setup()
    const good = stubResources().saveLines
    const saveLines = vi.fn(good).mockRejectedValueOnce(new Error('boom'))
    renderPanel('acct-1', { saveLines })

    await user.click(screen.getByRole('button', { name: 'Edit VTI' }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5{Enter}')

    expect(await screen.findByText('Could not save VTI: boom')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for VTI')).toHaveValue('5')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(/Saved/)).toBeInTheDocument()
    expect(saveLines).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Could not save VTI: boom')).not.toBeInTheDocument()
  })

  it('re-derives lines when the snapshot prop changes while idle', () => {
    const { rerenderWith, snapshot } = renderPanel('acct-1')

    rerenderWith({ ...snapshot, holdings: [snapshot.holdings![0], { ...snapshot.holdings![1], valueUSD: 1100 }] })

    expect(screen.getByRole('button', { name: 'Edit VTI' })).toHaveTextContent('$1,100.00')
  })

  it('undoes a save on a holdings-less snapshot back to the prior balance', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('manual-loan', { balanceOnly: true, liabilityBalance: true })

    await user.click(screen.getByRole('button', { name: 'Edit Statement balance' }))
    await user.clear(screen.getByLabelText('Value for US Dollar'))
    await user.type(screen.getByLabelText('Value for US Dollar'), '12345{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(resources.saveLines).toHaveBeenCalledTimes(2))
    expect(savedLines(resources, 1)).toEqual([expect.objectContaining({ quantity: 18500, valueUSD: 18500 })])
    expect(savedLines(resources, 1)[0].asset.id).toBe('asset-usd')
  })

  it('edits the single balance line of a balance-only liability as a positive amount', async () => {
    const user = userEvent.setup()
    const { resources } = renderPanel('manual-loan', { balanceOnly: true, liabilityBalance: true })

    expect(screen.getByText('Balance on Thu, May 21')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Statement balance' }))
    expect(screen.queryByLabelText(/^Quantity for/)).not.toBeInTheDocument()
    const value = screen.getByLabelText('Value for US Dollar')
    expect(value).toHaveValue('18500.00')
    await user.clear(value)
    await user.type(value, '-19000{Enter}')

    await waitFor(() => expect(resources.saveLines).toHaveBeenCalledTimes(1))
    expect(savedLines(resources)).toHaveLength(1)
    expect(savedLines(resources)[0]).toMatchObject({ quantity: 19000, valueUSD: 19000 })
  })

  it('renders plain lines without write access', () => {
    renderPanel('acct-1', { canWriteWealth: false })

    expect(screen.queryAllByRole('button', { name: /^Edit / })).toHaveLength(0)
    expect(screen.getByText('4 shares')).toBeInTheDocument()
  })

  it('hides the Saved · Undo header after six seconds', async () => {
    vi.useFakeTimers()
    renderPanel('acct-1')

    fireEvent.click(screen.getByRole('button', { name: 'Edit VTI' }))
    fireEvent.change(screen.getByLabelText('Quantity for VTI'), { target: { value: '5' } })
    fireEvent.keyDown(screen.getByLabelText('Quantity for VTI'), { key: 'Enter' })
    await act(async () => {})

    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(6000) })
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
