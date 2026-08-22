export const STORAGE_KEY = 'section-history-v1'

const STICKY_SECTIONS = new Set([
  'expenses',
  'cash-flow',
  'transactions',
  'accounts',
  'net-worth',
  'portfolio',
])

export type SectionHistory = Record<string, string>

export function sectionOf(pathname: string): string {
  return pathname.split('/').find(Boolean) ?? ''
}

export function isStickySection(section: string): boolean {
  return STICKY_SECTIONS.has(section)
}

function cleanHistory(value: object): SectionHistory {
  const history: SectionHistory = {}

  for (const [section, url] of Object.entries(value)) {
    if (!isStickySection(section) || typeof url !== 'string') continue
    history[section] = url
  }

  return history
}

export function persistHistory(map: SectionHistory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanHistory(map)))
  } catch {
    // localStorage may be unavailable
  }
}

export function loadHistory(): SectionHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return cleanHistory(parsed)
  } catch {
    return {}
  }
}
