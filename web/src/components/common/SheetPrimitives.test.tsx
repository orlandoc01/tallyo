import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ActionSheet } from './ActionSheet'
import { MobileFilterFooter } from './MobileFilterFooter'
import { MobileSheet } from './MobileFilterDropdown'
import { PickerSheet } from './PickerSheet'
import { SheetFoot, SheetHero, SheetMeta } from './SheetHero'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow, SheetToggleRow } from './SheetRows'
import { SheetTabs } from './SheetTabs'
import { TickerChip } from './Tag'

function pointer(target: Element, type: string, clientY: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientY }))
}

function swipe(target: Element, from: number, to: number) {
  pointer(target, 'pointerdown', from)
  pointer(target, 'pointermove', to)
  pointer(target, 'pointerup', to)
}

describe('MobileSheet', () => {
  it('renders a title action and hides the close button on request', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onClose = vi.fn()
    render(
      <MobileSheet action={<button onClick={onAction} type="button">Create rule</button>} hideClose labelledBy="sheet-title" onClose={onClose} title="Details">
        <p>Body</p>
      </MobileSheet>,
    )

    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(onAction).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the clear-filters action and close button for filters', () => {
    render(<MobileSheet labelledBy="filters-title" onClear={vi.fn()} onClose={vi.fn()}><p>Filters body</p></MobileSheet>)
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close filters' })).toBeInTheDocument()
  })

  it('follows a header drag, snaps back under the threshold, and closes past it', () => {
    const onClose = vi.fn()
    render(<MobileSheet labelledBy="sheet-title" onClear={vi.fn()} onClose={onClose} title="Details"><p>Body</p></MobileSheet>)
    const title = screen.getByRole('heading', { name: 'Details' })
    const panel = screen.getByRole('dialog').firstElementChild as HTMLElement

    pointer(title, 'pointerdown', 100)
    pointer(title, 'pointermove', 130)
    expect(panel.style.transform).toBe('translateY(30px)')
    pointer(title, 'pointerup', 130)
    expect(panel.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()

    pointer(title, 'pointerdown', 100)
    pointer(title, 'pointermove', 150)
    pointer(title, 'pointercancel', 150)
    expect(panel.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()

    swipe(title, 100, 200)
    expect(onClose).toHaveBeenCalledOnce()
    expect(panel.style.transform).toBe('translateY(100px)')

    swipe(screen.getByRole('button', { name: 'Close filters' }), 100, 200)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a neutral primary footer button', () => {
    render(<MobileFilterFooter primaryLabel="Cancel" primaryVariant="secondary" onPrimary={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('bg-raised')
  })
})

describe('SheetRows', () => {
  it('shows changed summaries in accent and expands the panel', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const { rerender } = render(<SheetAccordionRow changed expanded={false} label="Category" onToggle={onToggle} summary="Groceries"><p>Panel</p></SheetAccordionRow>)
    expect(screen.getByText('Groceries')).toHaveClass('text-accent')
    expect(screen.queryByText('Panel')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /category/i }))
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(<SheetAccordionRow expanded label="Category" onToggle={onToggle} summary="Groceries"><p>Panel</p></SheetAccordionRow>)
    expect(screen.getByText('Groceries')).toHaveClass('text-text-2')
    expect(screen.getByText('Panel')).toBeInTheDocument()
  })

  it('renders static and toggle rows', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <SheetStaticRow label="Return" value="+12%" valueClassName="text-positive" />
        <SheetToggleRow checked={false} description="Keep history" label="Closed" onChange={onChange} />
      </>,
    )
    expect(screen.getByText('+12%')).toHaveClass('text-positive')
    expect(screen.getByText('Keep history')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Closed' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('selects one option in single mode and toggles in multi mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const options = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]
    const { rerender } = render(<SheetPickList options={options} selectedIds={['a']} onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /alpha/i })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: /beta/i }))
    expect(onChange).toHaveBeenLastCalledWith(['b'])

    rerender(<SheetPickList options={options} selectedIds={['a']} selectionMode="multi" onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: /beta/i }))
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
    await user.click(screen.getByRole('checkbox', { name: /alpha/i }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('renders a field with placeholder summary and focuses the input when expanded', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<SheetField expanded={false} label="Notes" multiline onChange={onChange} onToggle={vi.fn()} placeholder="Add a note" value="" />)
    expect(screen.getByText('Add a note')).toHaveClass('text-text-muted')
    rerender(<SheetField expanded label="Notes" multiline onChange={onChange} onToggle={vi.fn()} placeholder="Add a note" value="" />)
    const input = screen.getByRole('textbox', { name: 'Notes' })
    expect(input).toHaveFocus()
    await user.type(input, 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })
})

describe('SheetHero, SheetMeta, SheetFoot, SheetTabs', () => {
  it('renders hero, meta and foot rows', () => {
    render(
      <>
        <SheetHero avatar={<TickerChip size="md">VTI</TickerChip>} sub="Brokerage" title="Vanguard Total" value="$1,000.00" valueSub="+5%" />
        <SheetMeta rows={[{ k: 'Institution', v: 'Chase' }]} />
        <SheetFoot rows={[{ k: 'Transaction ID', v: 'txn-1', mono: true }]} />
      </>,
    )
    expect(screen.getByText('VTI')).toHaveClass('uppercase')
    expect(screen.getByText('Vanguard Total')).toBeInTheDocument()
    expect(screen.getByText('+5%')).toHaveClass('text-text-3')
    expect(screen.getByText('Chase')).toBeInTheDocument()
    expect(screen.getByText('txn-1')).toHaveClass('font-mono')
  })

  it('renders sticky underline tabs bound to routes', () => {
    render(
      <MemoryRouter initialEntries={['/accounts/1/info']}>
        <SheetTabs ariaLabel="Account sections" items={[{ to: '/accounts/1/info', children: 'Info' }, { to: '/accounts/1/valuation', children: 'Valuation' }]} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Account sections' })).toHaveClass('sticky')
    expect(screen.getByRole('link', { name: 'Info' })).toHaveClass('border-accent')
    expect(screen.getByRole('link', { name: 'Valuation' })).toHaveClass('border-transparent')
  })
})

describe('ActionSheet and PickerSheet', () => {
  it('runs the item without closing, and cancels from the footer', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ActionSheet hero={<p>Chase</p>} items={[{ label: 'Sync now', onSelect }, { label: 'Remove', destructive: true, disabled: true, onSelect: vi.fn() }]} onClose={onClose} title="Connection" />)

    const dialog = screen.getByRole('dialog', { name: 'Connection' })
    expect(within(dialog).getByText('Chase')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toHaveClass('text-negative')
    await user.click(within(dialog).getByRole('button', { name: 'Sync now' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lets a stateful caller advance past the chooser on select', async () => {
    const user = userEvent.setup()
    function Chooser() {
      const [step, setStep] = useState<'chooser' | 'next' | null>('chooser')
      if (step === 'chooser') return <ActionSheet items={[{ label: 'Next', onSelect: () => setStep('next') }]} onClose={() => setStep(null)} title="Pick" />
      return <p>{step === 'next' ? 'Next step open' : 'Dismissed'}</p>
    }
    render(<Chooser />)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Next step open')).toBeInTheDocument()
  })

  it('picks a value and closes, filtering long lists by search', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onClose = vi.fn()
    const options = Array.from({ length: 14 }, (_, index) => ({ id: `zone-${index}`, label: `Zone ${index}` }))
    render(<PickerSheet onChange={onChange} onClose={onClose} options={options} title="Timezone" value="zone-1" />)

    expect(screen.getByRole('radio', { name: 'Zone 1' })).toHaveAttribute('aria-checked', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Search timezone' }), 'Zone 13')
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    await user.click(screen.getByRole('radio', { name: 'Zone 13' }))
    expect(onChange).toHaveBeenCalledWith('zone-13')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('hides the search field for short lists', () => {
    render(<PickerSheet onChange={vi.fn()} onClose={vi.fn()} options={[{ id: 'a', label: 'A' }]} title="Sort" value="a" />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows an empty line when the search matches nothing', async () => {
    const user = userEvent.setup()
    const options = Array.from({ length: 14 }, (_, index) => ({ id: `zone-${index}`, label: `Zone ${index}` }))
    render(<PickerSheet onChange={vi.fn()} onClose={vi.fn()} options={options} title="Timezone" value="zone-1" />)
    await user.type(screen.getByRole('textbox', { name: 'Search timezone' }), 'nowhere')
    expect(screen.getByText('No matches.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
