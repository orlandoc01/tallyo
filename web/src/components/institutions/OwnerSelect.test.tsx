import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { owners } from '../../mocks/fixtures'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { OwnerSelect } from './OwnerSelect'

describe('OwnerSelect', () => {
  it('renders owner options', () => {
    render(
      <OwnerSelect canCreate={false} onChange={vi.fn()} onOwnerCreated={vi.fn()} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    expect(screen.getByRole('option', { name: 'alex' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'sam' })).toBeInTheDocument()
  })

  it('shows create option when canCreate is true', () => {
    render(
      <OwnerSelect canCreate onChange={vi.fn()} onOwnerCreated={vi.fn()} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    expect(screen.getByRole('option', { name: /create new owner/i })).toBeInTheDocument()
  })

  it('switches to inline creation mode when create option is selected', async () => {
    const user = userEvent.setup()

    render(
      <OwnerSelect canCreate onChange={vi.fn()} onOwnerCreated={vi.fn()} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    await user.selectOptions(screen.getByRole('combobox'), '__create__')

    expect(screen.getByPlaceholderText('Owner name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls onOwnerCreated after creating a new owner', async () => {
    const user = userEvent.setup()
    const onOwnerCreated = vi.fn()
    const onChange = vi.fn()

    render(
      <OwnerSelect canCreate onChange={onChange} onOwnerCreated={onOwnerCreated} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    await user.selectOptions(screen.getByRole('combobox'), '__create__')
    await user.type(screen.getByPlaceholderText('Owner name'), 'Lena')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => {
      expect(onOwnerCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lena' }))
    })
  })

  it('cancels inline creation and returns to select', async () => {
    const user = userEvent.setup()

    render(
      <OwnerSelect canCreate onChange={vi.fn()} onOwnerCreated={vi.fn()} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    await user.selectOptions(screen.getByRole('combobox'), '__create__')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Owner name')).not.toBeInTheDocument()
  })

  it('submits inline creation on Enter key', async () => {
    const user = userEvent.setup()
    const onOwnerCreated = vi.fn()

    render(
      <OwnerSelect canCreate onChange={vi.fn()} onOwnerCreated={onOwnerCreated} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    await user.selectOptions(screen.getByRole('combobox'), '__create__')
    await user.type(screen.getByPlaceholderText('Owner name'), 'Lena{Enter}')

    await waitFor(() => {
      expect(onOwnerCreated).toHaveBeenCalled()
    })
  })

  it('cancels inline creation on Escape key', async () => {
    const user = userEvent.setup()

    render(
      <OwnerSelect canCreate onChange={vi.fn()} onOwnerCreated={vi.fn()} owners={owners} value="owner-1" />,
      { wrapper: GraphqlTestProvider },
    )

    await user.selectOptions(screen.getByRole('combobox'), '__create__')
    await user.keyboard('{Escape}')

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
