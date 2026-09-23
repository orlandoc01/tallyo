import { Database, LayoutGrid, Link, ListChecks, Shield, SlidersHorizontal, Sparkles, Tag, Terminal, UserCheck, type LucideIcon } from 'lucide-react'
import { isOneOf } from './urlParams'

export type SettingsTabId = 'connections' | 'general' | 'categories' | 'rules' | 'assets' | 'tags' | 'access' | 'security' | 'configuration' | 'ai-integration'

export type SettingsTab = { value: SettingsTabId; label: string; description: string; icon: LucideIcon; subtitle?: string }

export const SETTINGS_TABS: SettingsTab[] = [
  { value: 'general', label: 'General', description: 'Theme, layout, and owners', icon: SlidersHorizontal },
  { value: 'access', label: 'Access', description: 'Manage passkeys and users', icon: UserCheck },
  { value: 'configuration', label: 'Configuration', description: 'Runtime and provider settings', icon: Terminal },
  { value: 'ai-integration', label: 'AI Integration', description: 'LLM categorization and MCP', icon: Sparkles },
  { value: 'tags', label: 'Tags', description: 'Transaction labels', icon: Tag },
  { value: 'connections', label: 'Connections', description: 'Bank data providers', icon: Link, subtitle: 'Manage bank data providers and their linked institutions.' },
  { value: 'security', label: 'Security', description: 'Authentication settings', icon: Shield, subtitle: 'Secret fields are obfuscated. Changes apply immediately; no server restart is needed.' },
  { value: 'categories', label: 'Categories', description: 'Category groups and management', icon: LayoutGrid },
  { value: 'rules', label: 'Rules', description: 'Automatic transaction rules', icon: ListChecks },
  { value: 'assets', label: 'Assets', description: 'Manually tracked assets', icon: Database },
]

const TAB_VALUES = SETTINGS_TABS.map((tab) => tab.value)

function isSettingsTab(value: string | undefined): value is SettingsTabId {
  return isOneOf(TAB_VALUES, value)
}

export function settingsTabFromPath(pathname: string): SettingsTabId | null {
  const [, base, tab] = pathname.split('/')
  if (base !== 'settings') return null
  return isSettingsTab(tab) ? tab : null
}

export function settingsTabLabel(tab: SettingsTabId) {
  return SETTINGS_TABS.find((item) => item.value === tab)?.label ?? ''
}
