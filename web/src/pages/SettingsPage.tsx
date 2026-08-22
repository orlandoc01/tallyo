import clsx from 'clsx'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { hasAccessToken, hasMasterPassword } from '../auth/tokenStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePermissions } from '../hooks/usePermissions'
import { isOneOf } from '../hooks/urlParams'
import { Card, SectionLabel } from '../components/common/FormControls'
import { mobileHeaderActionClass } from '../components/common/mobileHeaderActionClass'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { AiIntegrationTab } from '../components/settings/AiIntegrationTab'
import { AssetsTab } from '../components/settings/AssetsTab'
import { SecurityConfigTab } from '../components/settings/SecurityConfigTab'
import { ConfigurationTab } from '../components/settings/ConfigurationTab'
import { ConnectionsTab } from '../components/settings/ConnectionsTab'
import { SecurityTab } from '../components/settings/SecurityTab'
import { TagsTab } from '../components/settings/TagsTab'
import { GeneralSettingsTab } from '../components/settings/GeneralSettingsTab'
import { AccessPage } from './AccessPage'
import { CategoriesPage } from './CategoriesPage'
import { RulesPage } from './RulesPage'

type Tab = 'connections' | 'general' | 'categories' | 'rules' | 'assets' | 'tags' | 'access' | 'security' | 'configuration' | 'ai-integration'

type SettingsTab = { value: Tab; label: string; description: string }

const TABS: SettingsTab[] = [
  { value: 'general', label: 'General', description: 'Theme, layout, and owners' },
  { value: 'access', label: 'Access', description: 'Manage passkeys and users' },
  { value: 'configuration', label: 'Configuration', description: 'Runtime and provider settings' },
  { value: 'ai-integration', label: 'AI Integration', description: 'LLM categorization and MCP' },
  { value: 'tags', label: 'Tags', description: 'Transaction labels' },
  { value: 'connections', label: 'Connections', description: 'Bank data providers' },
  { value: 'security', label: 'Security', description: 'Authentication settings' },
  { value: 'categories', label: 'Categories', description: 'Category and group management' },
  { value: 'rules', label: 'Rules', description: 'Transaction automation rules' },
  { value: 'assets', label: 'Assets', description: 'Manual assets and liabilities' },
]

const TAB_VALUES = TABS.map((tab) => tab.value)

function isTab(value: string | undefined): value is Tab {
  return isOneOf(TAB_VALUES, value)
}

function tabFromPath(pathname: string): Tab | null {
  const [, base, tab] = pathname.split('/')
  if (base !== 'settings') return null
  return isTab(tab) ? tab : null
}

function settingsPath(tab: Tab) {
  return `/settings/${tab}`
}

export function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
  const { canRead } = usePermissions()
  const { setHeaderLeading } = useMobileHeader()
  const isMobile = useIsMobile()
  const visibleTabs = TABS.filter((tab) => {
    if (!canRead('settings') && (tab.value === 'security' || tab.value === 'configuration' || tab.value === 'ai-integration')) return false
    if (!canRead('settings') && tab.value === 'connections') return false
    if (!canRead('tags') && tab.value === 'tags') return false
    if (!canRead('transactions') && tab.value === 'rules') return false
    if (disableTransactionTracking && (tab.value === 'tags' || tab.value === 'categories' || tab.value === 'rules')) return false
    if ((!canRead('assets') || disableWealthTracking) && tab.value === 'assets') return false
    return true
  })
  const activeTab = tabFromPath(location.pathname)
  const activeTabMeta = TABS.find((t) => t.value === activeTab)
  const activeTabVisible = activeTab ? visibleTabs.some((tab) => tab.value === activeTab) : false
  const isSettingsRoot = location.pathname === '/settings' || location.pathname === '/settings/'

  const mobileBackButton = useMemo(() => {
    if (!isMobile || isSettingsRoot || !activeTab) return null
    return (
      <button
        aria-label="Back to settings"
        className={mobileHeaderActionClass('flex items-center gap-1 rounded-xl px-2 py-2 text-sm font-semibold')}
        onClick={() => navigate('/settings')}
        type="button"
      >
        <ArrowLeft className="h-5 w-5" />
        Settings
      </button>
    )
  }, [activeTab, isMobile, isSettingsRoot, navigate])

  useEffect(() => {
    setHeaderLeading(mobileBackButton)
    return () => setHeaderLeading(null)
  }, [mobileBackButton, setHeaderLeading])

  if (isSettingsRoot) {
    if (isMobile) return <MobileSettingsIndex tabs={visibleTabs} />
    return <Navigate replace to="/settings/general" />
  }

  if (location.pathname === '/settings/plaid') {
    return <Navigate replace to="/settings/connections" />
  }

  if (!activeTab || !activeTabMeta || !activeTabVisible) {
    return <Navigate replace to={isMobile ? '/settings' : '/settings/general'} />
  }

  if (isMobile && activeTab === 'assets') {
    return <SettingsTabPanel tab={activeTab} />
  }

  if (isMobile) {
    return (
      <div className="space-y-5">
        <div>
          <SectionLabel as="p">Settings</SectionLabel>
          <h1 className="mt-1 text-2xl font-bold text-neutral-950">{activeTabMeta.label}</h1>
        </div>
        <SettingsTabPanel tab={activeTab} />
      </div>
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[max-content_minmax(0,1fr)]">
      <SettingsSidebar tabs={visibleTabs} />
      <div className="min-w-0">
        <SettingsTabPanel tab={activeTab} />
      </div>
    </div>
  )
}

function SettingsSidebar({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <aside className="hidden w-56 lg:block">
      <nav aria-label="Settings sections" className="sticky top-6 rounded-3xl border border-neutral-200 bg-white p-2 shadow-card">
        <div className="px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-600">Settings</p>
        </div>
        <div className="space-y-1">
          {tabs.map((tab) => (
            <NavLink
              className={({ isActive }) => clsx(
                'flex items-center rounded-2xl px-3 py-3 text-sm font-semibold transition',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
              )}
              key={tab.value}
              to={settingsPath(tab.value)}
            >
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  )
}

function MobileSettingsIndex({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <div className="space-y-6 lg:hidden">
      <div>
        <h1 className="text-2xl font-bold text-neutral-950">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">Choose a section to manage.</p>
      </div>

      <Card aria-label="Settings sections" as="nav">
        {tabs.map((tab, index) => (
          <Link
            className={clsx(
              'flex items-center gap-3 px-4 py-4 text-left transition hover:bg-neutral-50',
              index > 0 && 'border-t border-neutral-100',
            )}
            key={tab.value}
            to={settingsPath(tab.value)}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-950">{tab.label}</span>
              <span className="mt-0.5 block truncate text-xs text-neutral-500">{tab.description}</span>
            </span>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-neutral-400" />
          </Link>
        ))}
      </Card>
    </div>
  )
}

function SettingsTabPanel({ tab }: { tab: Tab }) {
  if (tab === 'connections') return <ConnectionsTab />
  if (tab === 'categories') return <CategoriesPage />
  if (tab === 'rules') return <RulesPage />
  if (tab === 'assets') return <AssetsTab />
  if (tab === 'tags') return <TagsTab />
  if (tab === 'access') return <AccessSettingsTab />
  if (tab === 'security') return <SecurityConfigTab />
  if (tab === 'configuration') return <ConfigurationTab />
  if (tab === 'ai-integration') return <AiIntegrationTab />
  return <GeneralSettingsTab />
}

function AccessSettingsTab() {
  const { canRead } = usePermissions()
  const showPasskeys = !hasMasterPassword() || hasAccessToken()

  return (
    <div className="space-y-8">
      {showPasskeys ? (
        <section className="space-y-3">
          <SectionLabel>Passkeys</SectionLabel>
          <SecurityTab />
        </section>
      ) : null}

      {canRead('users') ? (
        <>
          {showPasskeys ? <div className="border-t border-neutral-200" /> : null}
          <section className="space-y-3">
            <SectionLabel>Users</SectionLabel>
            <AccessPage />
          </section>
        </>
      ) : null}
    </div>
  )
}
