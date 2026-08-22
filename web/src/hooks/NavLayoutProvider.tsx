import { useCallback, useState, type ReactNode } from 'react'
import { ALL_NAV_ITEMS, MAX_NAVBAR_ITEMS, type NavItemId } from './navItems'
import { NavLayoutContext, type NavLayout } from './navLayoutContext'

const STORAGE_KEY = 'nav-layout-v1'

const RAW_DEFAULT_LAYOUT: NavLayout = {
  navbar: ['net-worth', 'portfolio', 'expenses', 'cash-flow'],
  sidemenu: ['transactions', 'review', 'budgets', 'recurring', 'accounts'],
}

const RENAMED_NAV_ITEMS: Partial<Record<string, NavItemId>> = {
  connections: 'accounts',
  institutions: 'accounts',
}

const allIds = new Set<NavItemId>(ALL_NAV_ITEMS.map((i) => i.id))

function normalizeIds(ids: unknown[]): NavItemId[] {
  const normalized: NavItemId[] = []
  const seen = new Set<NavItemId>()

  for (const rawId of ids) {
    if (typeof rawId !== 'string') continue

    const id = RENAMED_NAV_ITEMS[rawId] ?? rawId
    if (!allIds.has(id as NavItemId)) continue

    const navId = id as NavItemId
    if (seen.has(navId)) continue

    normalized.push(navId)
    seen.add(navId)
  }

  return normalized
}

function normalizeLayout(layout: { navbar?: unknown; sidemenu?: unknown }): NavLayout {
  const navbar = Array.isArray(layout.navbar) ? normalizeIds(layout.navbar) : []
  const sidemenu = Array.isArray(layout.sidemenu) ? normalizeIds(layout.sidemenu) : []
  const seen = new Set<NavItemId>()

  const uniqueNavbar: NavItemId[] = []
  const navbarOverflow: NavItemId[] = []
  for (const id of navbar) {
    if (uniqueNavbar.length < MAX_NAVBAR_ITEMS) {
      uniqueNavbar.push(id)
      seen.add(id)
    } else {
      navbarOverflow.push(id)
    }
  }

  const uniqueSidemenu = navbarOverflow.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  uniqueSidemenu.push(...sidemenu.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }))

  for (const item of ALL_NAV_ITEMS) {
    if (!seen.has(item.id)) {
      uniqueSidemenu.push(item.id)
      seen.add(item.id)
    }
  }

  return { navbar: uniqueNavbar, sidemenu: uniqueSidemenu }
}

const DEFAULT_LAYOUT = normalizeLayout(RAW_DEFAULT_LAYOUT)

function persistLayout(layout: NavLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // localStorage may be unavailable
  }
}

function loadLayout(): NavLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      persistLayout(DEFAULT_LAYOUT)
      return DEFAULT_LAYOUT
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.navbar) || !Array.isArray(parsed.sidemenu)) {
      persistLayout(DEFAULT_LAYOUT)
      return DEFAULT_LAYOUT
    }

    const layout = normalizeLayout(parsed)
    if (JSON.stringify(layout) !== raw) {
      persistLayout(layout)
    }

    return layout
  } catch {
    persistLayout(DEFAULT_LAYOUT)
    return DEFAULT_LAYOUT
  }
}

export function NavLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<NavLayout>(loadLayout)

  const updateLayout = useCallback((newLayout: NavLayout) => {
    const normalizedLayout = normalizeLayout(newLayout)
    setLayout(normalizedLayout)
    persistLayout(normalizedLayout)
  }, [])

  return (
    <NavLayoutContext.Provider value={{ layout, updateLayout }}>
      {children}
    </NavLayoutContext.Provider>
  )
}
