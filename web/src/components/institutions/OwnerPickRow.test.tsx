import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { owners } from '../../mocks/fixtures'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { OwnerPickRow } from './OwnerPickRow'

function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('owner-1')
  const [expanded, setExpanded] = useState(true)
  return (
    <MobileSheet labelledBy="owner-sheet" onClose={onClose} title="Owner test">
      <OwnerPickRow canCreate expanded={expanded} onChange={setValue} onToggle={() => setExpanded((current) => !current)} owners={owners} value={value} />
    </MobileSheet>
  )
}

describe('OwnerPickRow', () => {
  it('swaps to the create form and back on Cancel', async () => {
    const user = userEvent.setup()
    render(<Harness onClose={vi.fn()} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('radio', { name: 'alex' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: '+ New owner' }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('radio', { name: 'sam' })).toBeInTheDocument()
  })

  it('keeps the sheet open when Escape is pressed inside the owner-name field', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: '+ New owner' }))
    await user.type(screen.getByRole('textbox', { name: 'Owner name' }), 'jo{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'alex' })).toBeInTheDocument()
  })
})
