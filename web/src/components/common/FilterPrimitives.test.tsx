import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeltaText } from './DeltaText'
import { Donut } from './Donut'
import { FilterDropdown, FilterOptionRow, FilterPresetRow } from './FilterChip'
import { FilterRadioList } from './FilterCheckboxList'
import { FilterPanel } from './FilterPanel'
import { FiltersButton } from './FiltersButton'
import { MobileFilterButton } from './MobileFilterDropdown'
import { MobileFilterFooter } from './MobileFilterFooter'
import { TickerChip } from './Tag'

describe('FilterDropdown', () => {
  it('opens, toggles options and closes on outside click or Escape', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <>
        <button type="button">Outside</button>
        <FilterDropdown active={false} label="Owner">
          <FilterOptionRow ariaLabel="Alex" count={3} label="Alex" onToggle={onToggle} selected={false} />
        </FilterDropdown>
      </>,
    )

    const chip = screen.getByRole('button', { name: 'Owner' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('checkbox', { name: 'Alex' })).not.toBeInTheDocument()

    await user.click(chip)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('checkbox', { name: 'Alex' })).not.toBeInTheDocument()
  })

  it('shows the selection summary and closes after a single-select preset', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <FilterDropdown active label="Date" summary="Past month" width={200}>
        {(close) => <FilterPresetRow hint="1M" label="Past month" onSelect={() => { onSelect(); close() }} selected />}
      </FilterDropdown>,
    )

    const chip = screen.getByRole('button', { name: 'Date Past month' })
    expect(chip).toHaveClass('border-brand-600')
    await user.click(chip)
    const preset = screen.getByRole('radio', { name: 'Past month 1M' })
    expect(preset).toHaveAttribute('aria-checked', 'true')
    await user.click(preset)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('FilterPanel and FiltersButton', () => {
  it('disables clear filters when nothing is active', async () => {
    const onClear = vi.fn()
    const { rerender } = render(<FilterPanel clearable={false} onClear={onClear}><span>chips</span></FilterPanel>)
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
    rerender(<FilterPanel clearable onClear={onClear}><span>chips</span></FilterPanel>)
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('renders the badge, open and active states', () => {
    const { rerender } = render(<FiltersButton onClick={vi.fn()} open={false} />)
    const button = screen.getByRole('button', { name: 'Filters' })
    expect(button).toHaveClass('border-border-strong', 'bg-raised')

    rerender(<FiltersButton count={2} onClick={vi.fn()} open={false} />)
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toHaveClass('border-brand-600', 'bg-raised')

    rerender(<FiltersButton count={2} onClick={vi.fn()} open />)
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toHaveClass('border-brand-600', 'bg-border-strong')
    expect(screen.getByText('2')).toHaveClass('bg-brand-600')
  })

  it('floats a count badge over the mobile filter button', () => {
    render(<MobileFilterButton count={3} onClick={vi.fn()} />)
    expect(screen.getByText('3')).toHaveClass('absolute')
    expect(screen.getByRole('button', { name: 'Open filters, 3 active' })).toHaveClass('bg-border-strong')
  })

  it('renders a single full-width primary footer action', () => {
    render(<MobileFilterFooter primaryLabel="Apply" onPrimary={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveClass('flex-1')
  })

  it('renders single-select radio rows', async () => {
    const onChange = vi.fn()
    render(<FilterRadioList options={[{ id: 'YTD', label: 'Year to date', trailing: 'YTD' }, { id: 'ALL', label: 'All time' }]} selectedId="YTD" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Year to date YTD' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'All time' }))
    expect(onChange).toHaveBeenCalledWith('ALL')
  })
})

describe('Donut', () => {
  const slices = [
    { key: 'a', label: 'Alpha', value: 60, color: '#111' },
    { key: 'b', label: 'Beta', value: 40, color: '#222' },
  ]

  it('renders one path per slice and dims the others on hover', async () => {
    const user = userEvent.setup()
    const onHover = vi.fn()
    const onSelect = vi.fn()
    const { rerender } = render(<Donut ariaLabel="Test donut" hoveredKey={null} slices={slices} onHover={onHover} onSelect={onSelect} />)

    const paths = screen.getByRole('img', { name: 'Test donut' }).querySelectorAll('path')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveAttribute('fill', '#111')
    expect(paths[0]).toHaveStyle({ opacity: '1' })
    expect(paths[0].querySelector('title')).toHaveTextContent('Alpha')

    await user.hover(paths[0])
    expect(onHover).toHaveBeenCalledWith('a')
    await user.unhover(paths[0])
    expect(onHover).toHaveBeenLastCalledWith(null)
    await user.click(paths[1])
    expect(onSelect).toHaveBeenCalledWith('b')

    rerender(<Donut ariaLabel="Test donut" hoveredKey="a" slices={slices} onHover={onHover} onSelect={onSelect} />)
    expect(paths[0]).toHaveStyle({ transform: 'scale(1.04)' })
    expect(paths[1]).toHaveStyle({ opacity: '0.35' })
  })

  it('draws a full ring for a single slice and skips zero-value slices', () => {
    render(<Donut ariaLabel="Solo" slices={[slices[0], { key: 'zero', label: 'Zero', value: 0, color: '#333' }]} />)
    const paths = screen.getByRole('img', { name: 'Solo' }).querySelectorAll('path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('d')).toContain('A 100 100 0 1 1')
  })

  it('ignores touch hover and only reacts to mouse pointers', async () => {
    const user = userEvent.setup()
    const onHover = vi.fn()
    render(<Donut ariaLabel="Touch" hoveredKey={null} slices={slices} onHover={onHover} />)
    const path = screen.getByRole('img', { name: 'Touch' }).querySelector('path')
    if (!path) throw new Error('missing path')
    fireEvent.pointerEnter(path, { pointerType: 'touch' })
    expect(onHover).not.toHaveBeenCalled()
    await user.hover(path)
    expect(onHover).toHaveBeenCalledWith('a')
  })
})

describe('DeltaText and TickerChip', () => {
  it('renders glyph, sign and zero variants with inverted tones', () => {
    const { rerender } = render(<DeltaText changePct={162.4} changeUSD={12_100_000} />)
    expect(screen.getByText('▲ $12.10M (162.4%)')).toHaveClass('text-positive')

    rerender(<DeltaText changePct={-2} changeUSD={-2100} invert />)
    expect(screen.getByText('▼ $2.10K (2.0%)')).toHaveClass('text-positive')

    rerender(<DeltaText changePct={0} changeUSD={0} />)
    expect(screen.getByText('$0 (0%)')).toHaveClass('text-text-muted')

    rerender(<DeltaText changePct={-20} changeUSD={-250} glyph={false} masked size="sm" />)
    expect(screen.getByText('-$•••.•• (••.•%)')).toHaveClass('text-negative', 'text-xs')
  })

  it('renders truncated ticker chips', () => {
    render(<TickerChip>bitcoin</TickerChip>)
    expect(screen.getByText('bitc')).toHaveClass('uppercase')
  })
})
