import { LogOut } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { hasAccessToken, hasMasterPassword } from '../auth/tokenStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePermissions } from '../hooks/usePermissions'
import { Button } from '../components/common/Button'
import { AiIntegrationTab } from '../components/settings/AiIntegrationTab'
import { AssetsTab } from '../components/settings/AssetsTab'
import { SecurityConfigTab } from '../components/settings/SecurityConfigTab'
import { ConfigurationTab } from '../components/settings/ConfigurationTab'
import { ConnectionsTab } from '../components/settings/ConnectionsTab'
import { SecurityTab } from '../components/settings/SecurityTab'
import { TagsTab } from '../components/settings/TagsTab'
import { GeneralSettingsTab } from '../components/settings/GeneralSettingsTab'
import { MobileSettingsIndex, SettingsSidebar } from '../components/settings/SettingsNav'
import { SettingsTitleRow } from '../components/settings/SettingsTitleRow'
import { AccessPage } from './AccessPage'
import { CategoriesPage } from './CategoriesPage'
import { RulesPage } from './RulesPage'
import { SETTINGS_TABS, settingsTabFromPath, type SettingsTab, type SettingsTabId } from '../hooks/settingsTabs'

export function SettingsPage() {
  const location = useLocation()
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
  const { canRead } = usePermissions()
  const isMobile = useIsMobile()
  const visibleTabs = SETTINGS_TABS.filter((tab) => {
    if (!canRead('settings') && (tab.value === 'security' || tab.value === 'configuration' || tab.value === 'ai-integration')) return false
    if (!canRead('settings') && tab.value === 'connections') return false
    if (!canRead('tags') && tab.value === 'tags') return false
    if (!canRead('transactions') && tab.value === 'rules') return false
    if (disableTransactionTracking && (tab.value === 'tags' || tab.value === 'categories' || tab.value === 'rules')) return false
    if ((!canRead('assets') || disableWealthTracking) && tab.value === 'assets') return false
    return true
  })
  const activeTab = settingsTabFromPath(location.pathname)
  const activeTabMeta = SETTINGS_TABS.find((t) => t.value === activeTab)
  const activeTabVisible = activeTab ? visibleTabs.some((tab) => tab.value === activeTab) : false
  const isSettingsRoot = location.pathname === '/settings' || location.pathname === '/settings/'

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

  if (isMobile) {
    return <SettingsTabContent tab={activeTabMeta} />
  }

  return (
    <div className="grid grid-cols-[minmax(190px,240px)_minmax(0,1fr)] gap-3">
      <SettingsSidebar tabs={visibleTabs} />
      <SettingsTabContent tab={activeTabMeta} />
    </div>
  )
}

const SELF_TITLED_TABS: ReadonlySet<SettingsTabId> = new Set(['tags', 'rules', 'categories', 'assets'])

function SettingsTabContent({ tab }: { tab: SettingsTab }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {SELF_TITLED_TABS.has(tab.value) ? null : <SettingsTitleRow subtitle={tab.subtitle} title={tab.label} />}
      <SettingsTabPanel tab={tab.value} />
    </div>
  )
}

function SettingsTabPanel({ tab }: { tab: SettingsTabId }) {
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
  const { logout } = useAuth()
  const { canRead } = usePermissions()
  const showPasskeys = !hasMasterPassword() || hasAccessToken()
  const showUsers = canRead('users')
  const signOut = (
    <Button onClick={logout} size="sm" variant="danger">
      <LogOut aria-hidden className="h-3.5 w-3.5" />
      Sign out
    </Button>
  )

  return (
    <div className="space-y-3">
      {showPasskeys ? <SecurityTab headerActions={signOut} /> : null}
      {showUsers ? <AccessPage headerActions={showPasskeys ? undefined : signOut} /> : null}
      {!showPasskeys && !showUsers ? <div className="flex justify-end">{signOut}</div> : null}
    </div>
  )
}
