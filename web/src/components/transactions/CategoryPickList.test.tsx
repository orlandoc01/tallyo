import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories } from '../../mocks/fixtures'
import { CategoryPickList } from './CategoryPickList'

describe('CategoryPickList', () => {
  it('groups categories under their group names and reports the picked id', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CategoryPickList categories={categories} onChange={onChange} selectedId="1" />)

    expect(screen.getByText('Food')).toHaveClass('uppercase')
    expect(screen.getByRole('radio', { name: 'Groceries' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('radio', { name: 'Uncategorized' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Interest' }))
    expect(onChange).toHaveBeenCalledWith(['3'])
  })

  it('prepends a none option when noneLabel is set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CategoryPickList categories={categories} noneLabel="Uncategorized" onChange={onChange} selectedId="" />)

    const none = screen.getByRole('radio', { name: 'Uncategorized' })
    expect(none).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio')[0]).toBe(none)
    await user.click(screen.getByRole('radio', { name: 'Groceries' }))
    expect(onChange).toHaveBeenCalledWith(['1'])
  })
})
