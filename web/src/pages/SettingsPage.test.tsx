import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { clearMasterPassword, clearTokens, setMasterPassword } from '../auth/tokenStore'
import { renderWithProviders } from '../test/renderWithProviders'
import { SettingsPage } from './SettingsPage'

const mockViewport = vi.hoisted(() => ({ isMobile: false }))

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => mockViewport.isMobile,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canRead: () => true,
    canWrite: (resource: string) => resource === 'owners',
    hasScope: () => true,
  }),
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    disableTransactionTracking: false,
    disableWealthTracking: false,
    hideOwners: false,
    refreshGeneralConfiguration: vi.fn(),
  }),
}))

vi.mock('./AccessPage', () => ({
  AccessPage: () => <div>Users content</div>,
}))

vi.mock('../components/settings/SecurityTab', () => ({
  SecurityTab: () => <div>Passkeys content</div>,
}))

vi.mock('../components/settings/LayoutSection', () => ({
  LayoutSection: () => <div>Layout</div>,
}))

vi.mock('../components/settings/AssetsTab', () => ({
  AssetsTab: () => <div>Assets tab content</div>,
}))

vi.mock('../components/settings/ConnectionsTab', () => ({
  ConnectionsTab: () => <div>Connections tab content</div>,
}))

afterEach(() => {
  mockViewport.isMobile = false
  clearMasterPassword()
  clearTokens()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function MobileHeaderLeadingProbe() {
  const { headerLeading } = useMobileHeader()
  return <div data-testid="mobile-header-leading">{headerLeading}</div>
}

function renderSettings(path = '/settings/general') {
  return renderWithProviders(<SettingsPage />, {
    initialEntries: [path],
    probes: <MobileHeaderLeadingProbe />,
    withGraphql: true,
    withMobileHeader: true,
  })
}

describe('SettingsPage', () => {
  it('does not show the build version', () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.2.3')

    renderSettings()

    expect(screen.queryByText('v1.2.3')).not.toBeInTheDocument()
  })

  it('hides the version when the build does not provide one', () => {
    renderSettings()

    expect(screen.queryByText(/^v\d+\.\d+\.\d+$/)).not.toBeInTheDocument()
  })

  it('renders appearance and owners sections without user management', () => {
    renderSettings()

    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /system/i })).toBeInTheDocument()
    expect(screen.getByText('Owners')).toBeInTheDocument()
    expect(screen.queryByText('Users content')).not.toBeInTheDocument()
  })

  it('renders the layout section on mobile general settings', () => {
    mockViewport.isMobile = true
    renderSettings()

    expect(screen.getByRole('heading', { level: 2, name: 'Layout' })).toBeInTheDocument()
  })

  it('switches theme when a theme button is clicked', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: /dark/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByRole('button', { name: /light/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    await user.click(screen.getByRole('button', { name: /system/i }))
  })

  it('switches to the Assets tab', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('link', { name: /assets/i }))
    expect(screen.getByText('Assets tab content')).toBeInTheDocument()
  })

  it('renders passkeys and users on the Access tab', () => {
    renderSettings('/settings/access')

    expect(screen.getByRole('heading', { level: 2, name: 'Passkeys' })).toBeInTheDocument()
    expect(screen.getByText('Passkeys content')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Users content')).toBeInTheDocument()
  })

  it('hides passkeys and still shows users on the Access tab for master password sessions', () => {
    setMasterPassword('test-master-password')

    renderSettings('/settings/access')

    expect(screen.queryByRole('heading', { level: 2, name: 'Passkeys' })).not.toBeInTheDocument()
    expect(screen.queryByText('Passkeys content')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Users content')).toBeInTheDocument()
  })

  it('renders Security, Categories, Rules, and Assets as the last settings sections', () => {
    renderSettings()

    const links = within(screen.getByRole('navigation', { name: /settings sections/i })).getAllByRole('link').map((link) => link.textContent)
    expect(links.slice(-4)).toEqual(['Security', 'Categories', 'Rules', 'Assets'])
  })

  it('opens categories from the settings sections', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('link', { name: /categories/i }))

    expect(await screen.findByText('Food')).toBeInTheDocument()
  })

  it('renders the mobile settings index at /settings', () => {
    mockViewport.isMobile = true
    renderSettings('/settings')

    const sections = screen.getByRole('navigation', { name: /settings sections/i })
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(within(sections).getByRole('link', { name: /general/i })).toHaveAttribute('href', '/settings/general')
    expect(within(sections).getByRole('link', { name: /access/i })).toHaveAttribute('href', '/settings/access')
    expect(within(sections).getByRole('link', { name: /categories/i })).toHaveAttribute('href', '/settings/categories')
    expect(within(sections).getByRole('link', { name: /rules/i })).toHaveAttribute('href', '/settings/rules')
    expect(within(sections).getByRole('link', { name: /assets/i })).toHaveAttribute('href', '/settings/assets')
    expect(screen.queryByText('Connections tab content')).not.toBeInTheDocument()
  })

  it('redirects legacy Plaid settings to Connections', async () => {
    renderSettings('/settings/plaid')

    expect(await screen.findByText('Connections tab content')).toBeInTheDocument()
  })

  it('uses a mobile header back button on settings details', async () => {
    const user = userEvent.setup()
    mockViewport.isMobile = true
    renderSettings('/settings/assets')

    expect(screen.getByText('Assets tab content')).toBeInTheDocument()

    await user.click(within(screen.getByTestId('mobile-header-leading')).getByRole('button', { name: /back to settings/i }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})
