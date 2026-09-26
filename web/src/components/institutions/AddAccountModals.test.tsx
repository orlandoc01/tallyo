import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import { AddAccountModals, type LinkingStep } from './AddAccountModals'

const mockViewport = vi.hoisted(() => ({ isMobile: false }))

vi.mock('../../hooks/useIsMobile', () => ({
  useIsMobile: () => mockViewport.isMobile,
}))

afterEach(() => {
  mockViewport.isMobile = false
})

function Flow({ initialStep, onManualAccount = vi.fn() }: { initialStep: LinkingStep; onManualAccount?: () => void }) {
  const [step, setStep] = useState<LinkingStep>(initialStep)
  return (
    <>
      <p>Step: {step ?? 'none'}</p>
      <AddAccountModals onManualAccount={onManualAccount} onMessage={vi.fn()} onStepChange={setStep} step={step} />
    </>
  )
}

function renderFlow(initialStep: LinkingStep, onManualAccount?: () => void) {
  return renderWithProviders(<Flow initialStep={initialStep} onManualAccount={onManualAccount} />, { auth: {}, withGraphql: true })
}

describe('AddAccountModals', () => {
  it('opens the tile chooser modals on desktop', () => {
    renderFlow('add-account')
    expect(screen.getByRole('heading', { name: 'Add account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Manual account' })).toBeInTheDocument()
  })

  it('advances from the mobile chooser to the bank link modal', async () => {
    mockViewport.isMobile = true
    const user = userEvent.setup()
    renderFlow('chooser')

    const sheet = screen.getByRole('dialog', { name: 'Add account' })
    expect(screen.queryByRole('heading', { name: 'Link Connection' })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Link a bank' }))

    expect(screen.getByText('Step: bank')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Add account' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /link connection/i })).toBeInTheDocument()
  })

  it('opens the manual account flow and clears the step', async () => {
    mockViewport.isMobile = true
    const user = userEvent.setup()
    const onManualAccount = vi.fn()
    renderFlow('add-account', onManualAccount)

    const sheet = screen.getByRole('dialog', { name: 'Add account' })
    expect(screen.queryByRole('button', { name: 'Add Manual account' })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Add manual account' }))

    expect(onManualAccount).toHaveBeenCalledOnce()
    expect(screen.getByText('Step: none')).toBeInTheDocument()
  })

  it('routes the wallet and home items to their link modals', async () => {
    mockViewport.isMobile = true
    const user = userEvent.setup()
    const { unmount } = renderFlow('chooser')

    await user.click(within(screen.getByRole('dialog', { name: 'Add account' })).getByRole('button', { name: 'Link a crypto wallet' }))
    expect(screen.getByText('Step: evm')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /wallet/i })).toBeInTheDocument()
    unmount()

    renderFlow('chooser')
    await user.click(within(screen.getByRole('dialog', { name: 'Add account' })).getByRole('button', { name: 'Add home' }))
    expect(screen.getByText('Step: realestate')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /home/i })).toBeInTheDocument()
  })

  it('cancels the mobile chooser', async () => {
    mockViewport.isMobile = true
    const user = userEvent.setup()
    renderFlow('chooser')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Step: none')).toBeInTheDocument()
  })
})
