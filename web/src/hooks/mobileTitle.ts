import { ALL_NAV_ITEMS } from './navItems'
import { sectionOf } from './sectionHistory'
import { settingsTabFromPath, settingsTabLabel } from './settingsTabs'

export function mobileTitle(pathname: string) {
  const section = sectionOf(pathname)
  if (section === 'settings') {
    const tab = settingsTabFromPath(pathname)
    return tab ? settingsTabLabel(tab) : 'Settings'
  }
  return ALL_NAV_ITEMS.find((item) => sectionOf(item.to) === section)?.label ?? ''
}
