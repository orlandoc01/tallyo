import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { renderWithProviders } from '../test/renderWithProviders'
import { useQueryParamState } from './useQueryParamState'

function Harness() {
  const [value, setValue] = useQueryParamState('q')
  const [, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <>
      <output aria-label="url">{location.pathname + location.search}</output>
      <input aria-label="q" onChange={(event) => setValue(event.target.value)} value={value} />
      <button onClick={() => navigate(-1)} type="button">back</button>
      <button
        onClick={() => {
          setValue('')
          setSearchParams(new URLSearchParams(), { replace: true })
        }}
        type="button"
      >
        clear
      </button>
    </>
  )
}

function renderHarness(initialEntry: string) {
  return renderWithProviders(<Harness />, { initialEntries: [initialEntry] })
}

describe('useQueryParamState', () => {
  it('commits the value to its own query param immediately', () => {
    renderHarness('/transactions')

    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'coffee' } })

    expect(screen.getByLabelText('url')).toHaveTextContent('/transactions?q=coffee')
  })

  it('preserves other params when writing its own query param', () => {
    renderHarness('/transactions?owner_ids=owner-2')

    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'coffee' } })

    expect(screen.getByLabelText('url')).toHaveTextContent('/transactions?owner_ids=owner-2&q=coffee')
  })

  it('pushes once per search session and replaces later edits', () => {
    renderHarness('/transactions')

    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'c' } })
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'co' } })
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'coffee' } })
    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByLabelText('url')).toHaveTextContent('/transactions')
  })

  it('keeps pre-search filters when navigating back', () => {
    renderHarness('/transactions?category_ids=1')

    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByLabelText('url')).toHaveTextContent('/transactions?category_ids=1')
  })

  it('does not resurrect other params when clearing in the same handler', () => {
    renderHarness('/transactions?q=coffee&owner_ids=owner-2')

    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    expect(screen.getByLabelText('url')).toHaveTextContent('/transactions')
  })
})
