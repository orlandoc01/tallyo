import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analysisReportForInput } from '../mocks/fixtures'
import { server } from '../mocks/server'
import { absoluteRoutePath, PORTFOLIO_PATHS } from '../routes'
import { LocationDisplay, MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import type { AnalysisInput } from '../types/graphql'
import { PortfolioPage } from './PortfolioPage'

const permissionMocks = vi.hoisted(() => ({
  canRead: vi.fn<(resource: string) => boolean>(() => true),
  canWrite: vi.fn<(resource: string) => boolean>(() => true),
  hasScope: vi.fn<(scope: string) => boolean>(() => true),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => permissionMocks,
}))

describe('PortfolioPage', () => {
  beforeEach(() => {
    permissionMocks.canRead.mockReturnValue(true)
    permissionMocks.canWrite.mockReturnValue(true)
    permissionMocks.hasScope.mockReturnValue(true)
  })

  it('renders analysis and refetches when the view changes', async () => {
    window.history.pushState({}, '', '/portfolio')
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Allocation' })).toBeInTheDocument()
    expect(await screen.findByText('Stock')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('radio', { name: 'Sectors' })[0])
    expect(await screen.findByText('Technology')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/portfolio?view=sectors'))
  })

  it('updates and clears portfolio filters', async () => {
    window.history.pushState({}, '', '/portfolio?view=sectors&hide_amounts=true')
    renderPage(['/portfolio?view=sectors&hide_amounts=true'])

    await screen.findByText('Technology')

    fireEvent.click(screen.getByRole('button', { name: /^Filters$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Owner/i }))
    const ownerCheckbox = screen.getByRole('checkbox', { name: 'alex' })
    expect(ownerCheckbox).toHaveClass('absolute')
    fireEvent.click(ownerCheckbox)
    expect(ownerCheckbox.parentElement).toHaveClass('bg-brand-50')
    fireEvent.click(screen.getByRole('button', { name: /Account type/i }))
    const accountTypeCheckbox = screen.getByRole('checkbox', { name: 'Tax Advantaged' })
    fireEvent.click(accountTypeCheckbox)
    expect(accountTypeCheckbox.parentElement).toHaveClass('bg-brand-50')
    fireEvent.click(screen.getByRole('button', { name: /^Account All$/i }))
    const accountCheckbox = screen.getByRole('checkbox', { name: 'Brokerage (...3011)' })
    fireEvent.click(accountCheckbox)
    expect(accountCheckbox.parentElement).toHaveClass('bg-brand-50')
    fireEvent.click(screen.getByRole('switch', { name: 'Include unclassified' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Filters: 4 selected/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Clear all/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Filters$/i })).toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio?view=sectors&hide_amounts=true')
  })

  it('loads the analysis view from the URL query parameter', async () => {
    renderPage(['/portfolio?view=category'])

    expect(await screen.findByText('US Equity: Large Blend')).toBeInTheDocument()
    for (const select of screen.getAllByRole('combobox', { name: 'Analysis view' })) {
      expect(select).toHaveValue('MORNINGSTAR_CATEGORY')
    }
  })

  it('loads default analysis after URL ID filters are rejected', async () => {
    const inputs: AnalysisInput[] = []
    server.use(
      graphql.link('/query').query('Analysis', ({ variables }) => {
        const input = variables.input as AnalysisInput
        inputs.push(input)
        if (input.ownerIds?.length || input.accountIds?.length) return HttpResponse.json({ errors: [{ message: 'invalid global id' }] })
        return HttpResponse.json({ data: { analysis: analysisReportForInput(input) } })
      }),
    )
    renderPage(['/portfolio?view=composition&owners=sam&accounts=checking'])

    expect(await screen.findByRole('heading', { name: 'Allocation' })).toBeInTheDocument()
    expect(inputs).toContainEqual(expect.objectContaining({ ownerIds: ['sam'], accountIds: ['checking'] }))
    expect(inputs).toContainEqual(expect.not.objectContaining({ ownerIds: expect.any(Array), accountIds: expect.any(Array) }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/portfolio?view=composition'))
  })

  it('opens the asset editor from an expanded portfolio holding', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('Stock'))
    await user.click(screen.getByRole('button', { name: /Edit Vanguard Total Stock Market ETF/i }))

    expect(screen.getByRole('dialog', { name: /Edit Vanguard Total Stock Market ETF/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Identifier (ticker/symbol)')).toHaveValue('VTI')
  })

  it('opens portfolio assets without querying account holdings for portfolio-only users', async () => {
    const user = userEvent.setup()
    let latestSnapshotRequests = 0
    permissionMocks.canRead.mockImplementation((resource) => resource === 'portfolio')
    permissionMocks.canWrite.mockReturnValue(false)
    server.use(graphql.link('/query').query('AssetLatestSnapshot', () => {
      latestSnapshotRequests += 1
      return HttpResponse.json({ data: { node: null } })
    }))

    renderPage()

    await user.click(await screen.findByText('Stock'))
    await user.click(screen.getByRole('button', { name: /Edit Vanguard Total Stock Market ETF/i }))

    expect(screen.getByRole('dialog', { name: /Edit Vanguard Total Stock Market ETF/i })).toBeInTheDocument()
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    expect(latestSnapshotRequests).toBe(0)
  })

  it('masks portfolio amounts while leaving percentages visible', async () => {
    const user = userEvent.setup()
    renderPage(['/portfolio?view=composition'])

    await screen.findByRole('heading', { name: 'Allocation' })
    expect(screen.queryByText('....')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Hide amounts' })[0])

    expect(screen.getAllByRole('button', { name: 'Show amounts' }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio?view=composition&hide_amounts=true')
    expect(screen.getAllByText('....').length).toBeGreaterThan(0)
    expect(screen.getByText('70.0%')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Show amounts' })[0])

    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio?view=composition')
  })

  it('places portfolio filters in the mobile header actions', async () => {
    const user = userEvent.setup()
    renderPage()

    const filterButton = await screen.findByRole('button', { name: 'Open filters' })

    expect(filterButton).toHaveClass('rounded-xl', 'p-2.5')

    await user.click(filterButton)

    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed')
    expect(dialog).toHaveStyle({ top: '48px' })
    expect(dialog.firstElementChild).toHaveClass('absolute', 'right-0', 'top-0')
    expect(dialog.firstElementChild).toHaveClass('w-[min(20rem,100vw)]')
    expect(screen.getByText('Include unclassified')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Owner/i }))
    await user.click(screen.getByRole('checkbox', { name: 'alex' }))
    await user.click(screen.getByRole('button', { name: /Account type/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Tax Advantaged' }))
    await user.click(screen.getByRole('switch', { name: 'Include unclassified' }))
    await user.click(screen.getByRole('button', { name: /Clear all/i }))
  })
})

function renderPage(initialEntries = ['/portfolio']) {
  return renderWithProviders(
    <Routes>
      {PORTFOLIO_PATHS.map((path) => <Route element={<PortfolioPage />} key={path} path={absoluteRoutePath(path)} />)}
    </Routes>,
    {
      auth: { scopes: [], masterPasswordStatus: 'DISABLED' },
      initialEntries,
      probes: <><LocationDisplay /><MobileHeaderActionsHost /></>,
      withGraphql: true,
      withMobileHeader: true,
    },
  )
}
