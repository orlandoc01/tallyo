import clsx from 'clsx'
import { Link, NavLink } from 'react-router'
import type { SettingsTab, SettingsTabId } from '../../hooks/settingsTabs'
import { Card } from '../common/FormControls'

function settingsPath(tab: SettingsTabId) {
  return `/settings/${tab}`
}

export function SettingsSidebar({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <Card aria-label="Settings sections" as="nav" className="sticky top-4 self-start p-2">
      <p className="px-2.5 pb-2.5 pt-1.5 text-xs text-text-muted">Settings</p>
      <div className="flex flex-col gap-0.5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <NavLink
              className={({ isActive }) => clsx(
                'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition',
                isActive ? 'bg-raised-nav text-text-1' : 'text-text-muted hover:bg-raised',
              )}
              key={tab.value}
              to={settingsPath(tab.value)}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
              {tab.label}
            </NavLink>
          )
        })}
      </div>
    </Card>
  )
}

export function MobileSettingsIndex({ tabs }: { tabs: SettingsTab[] }) {
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Settings</h1>
      <p className="text-[13px] text-text-muted">Choose a section to manage.</p>
      <Card aria-label="Settings sections" as="nav">
        {tabs.map((tab, index) => {
          const Icon = tab.icon
          return (
            <Link
              className={clsx('flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-raised', index > 0 && 'border-t border-border')}
              key={tab.value}
              to={settingsPath(tab.value)}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-text-2" strokeWidth={1.6} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text-1">{tab.label}</span>
                <span className="block truncate text-xs text-text-muted">{tab.description}</span>
              </span>
              <span aria-hidden className="text-[10px] text-text-muted">▶</span>
            </Link>
          )
        })}
      </Card>
    </div>
  )
}
