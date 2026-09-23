import { useEffect } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { LocationDisplay, MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import { ReportsPage } from './ReportsPage'

type AuthOverride = NonNullable<Parameters<typeof renderWithProviders>[1]>['auth']

const MAY = 'breakdown_start_date=2026-05-01&breakdown_end_date=2026-05-31'
const ALL_TIME = 'breakdown_start_date=2000-01-01&breakdown_end_date=2026-12-31'

function ReportsRoutes() {
  return (
    <Routes>
      <Route element={<ReportsPage />} path="/expenses/:tab" />
    </Routes>
  )
}

function OpenFilterOnMount() {
  const { openFilter } = useMobileHeader()
  useEffect(() => { openFilter() }, [openFilter])
  return <ReportsRoutes />
}

function renderReports(search: string, options: { auth?: AuthOverride; mobile?: boolean; path?: string } = {}) {
  return renderWithProviders(options.mobile ? <OpenFilterOnMount /> : <ReportsRoutes />, {
    auth: options.auth ?? {},
    initialEntries: [`${options.path ?? '/expenses/breakdown'}?${search}`],
    probes: <><LocationDisplay /><MobileHeaderActionsHost /></>,
    withGraphql: true,
    withMobileHeader: true,
  })
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Filters/ }))
}

describe('ReportsPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function pinClock() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'))
  }

  it('removing the Date pill restores the default range', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(MAY)

    await openFilters(user)
    await user.click(await screen.findByRole('button', { name: /^Remove Date filter/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('breakdown_start_date=2026-06-01&breakdown_end_date=2026-06-30')
  })

  it('removing a category pill keeps a custom closed range', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(`${MAY}&category_ids=2`)

    await openFilters(user)
    await user.click(await screen.findByRole('button', { name: /^Remove Category filter/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(MAY)
    expect(screen.getByTestId('location')).not.toHaveTextContent('category_ids')
  })

  it('removing a category pill under All time keeps the all-time range', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(`${ALL_TIME}&category_ids=2`)

    await openFilters(user)
    await user.click(await screen.findByRole('button', { name: /^Remove Category filter/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(ALL_TIME)
    expect(screen.getByTestId('location')).not.toHaveTextContent('category_ids')
  })

  it('labels the Date pill "All time" under the all-time preset and resets on removal', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(ALL_TIME)

    await openFilters(user)
    const pill = await screen.findByRole('button', { name: 'Remove Date filter: All time' })
    expect(screen.getByRole('button', { name: /^Date/ })).toHaveTextContent('All time')
    await user.click(pill)

    expect(screen.getByTestId('location')).toHaveTextContent('breakdown_start_date=2026-06-01&breakdown_end_date=2026-06-30')
  })

  it('drops the category focus when the tab changes', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(MAY)

    await user.click(await screen.findByRole('button', { name: /Restaurants & Bars.*\$150\.00/ }))
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Trends' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/expenses/trends'))
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
  })

  it('normalises an unknown tab to breakdown and keeps the search', async () => {
    pinClock()
    renderReports(MAY, { path: '/expenses/bogus' })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/expenses/breakdown?${MAY}`))
  })

  it('hides the Date chip and skips it in the badge on Comparison', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports('comparison_start_date=2026-05-01&comparison_end_date=2026-05-31', { path: '/expenses/comparison' })

    await user.click(await screen.findByRole('button', { name: 'Filters' }))
    expect(screen.getByRole('button', { name: /^Category/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Date/ })).not.toBeInTheDocument()
  })

  it('renders the charts without the transactions card when transactions are not readable', async () => {
    pinClock()
    renderReports(MAY, { auth: { scopes: ['read:spending'], masterPasswordStatus: 'DISABLED' } })

    expect(await screen.findByRole('button', { name: /Restaurants & Bars.*\$150\.00/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transactions' })).not.toBeInTheDocument()
  })

  it('stages mobile sheet edits until Apply and discards them on close', async () => {
    pinClock()
    const user = userEvent.setup()
    renderReports(MAY, { mobile: true })

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    await user.click(screen.getByRole('switch', { name: 'Show hidden' }))
    await user.click(screen.getByRole('button', { name: 'Close filters' }))
    expect(dialog).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('is_hidden')

    await user.click(screen.getByRole('button', { name: /Open expense filters/ }))
    await screen.findByRole('dialog', { name: 'Filters' })
    expect(screen.getByRole('switch', { name: 'Show hidden' })).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('switch', { name: 'Show hidden' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByTestId('location')).toHaveTextContent('is_hidden=1')
  })
})
