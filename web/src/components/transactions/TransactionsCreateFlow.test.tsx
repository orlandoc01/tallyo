import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { accounts, categories, categoryGroups } from '../../mocks/fixtures'
import { renderWithProviders } from '../../test/renderWithProviders'
import { TransactionsCreateFlow, type CreateStep } from './TransactionsCreateFlow'

function Flow({ initialStep }: { initialStep: CreateStep }) {
  const [step, setStep] = useState<CreateStep>(initialStep)
  return (
    <>
      <p>Step: {step ?? 'none'}</p>
      <TransactionsCreateFlow accounts={accounts} categories={categories} categoryGroups={categoryGroups} filter={{}} onCreated={vi.fn()} onRuleCreated={vi.fn()} onStepChange={setStep} step={step} />
    </>
  )
}

function renderFlow(initialStep: CreateStep) {
  return renderWithProviders(<Flow initialStep={initialStep} />, { auth: {}, withGraphql: true })
}

describe('TransactionsCreateFlow', () => {
  it('advances from the chooser to the transaction modal', async () => {
    const user = userEvent.setup()
    renderFlow('chooser')

    await user.click(within(screen.getByRole('dialog', { name: 'Create' })).getByRole('button', { name: 'Transaction' }))

    expect(screen.getByText('Step: transaction')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Create' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create transaction' })).toBeInTheDocument()
  })

  it('advances from the chooser to the rule modal and closes it back to idle', async () => {
    const user = userEvent.setup()
    renderFlow('chooser')

    await user.click(within(screen.getByRole('dialog', { name: 'Create' })).getByRole('button', { name: 'Rule' }))
    expect(screen.getByText('Step: rule')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create rule' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Step: none')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Create rule' })).not.toBeInTheDocument()
  })
})
