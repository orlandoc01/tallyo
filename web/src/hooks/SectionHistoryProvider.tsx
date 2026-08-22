import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { SectionHistoryContext } from './sectionHistoryContext'
import { isStickySection, loadHistory, persistHistory, sectionOf, type SectionHistory } from './sectionHistory'

export function SectionHistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<SectionHistory>(loadHistory)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const section = sectionOf(location.pathname)
    if (!isStickySection(section)) return

    const full = location.pathname + location.search + location.hash
    setHistory((prev) => (prev[section] === full ? prev : { ...prev, [section]: full }))
  }, [location.hash, location.pathname, location.search])

  useEffect(() => {
    persistHistory(history)
  }, [history])

  const value = useMemo(() => {
    const stickyTo = (defaultTo: string) => {
      const section = sectionOf(defaultTo)
      return (isStickySection(section) && history[section]) || defaultTo
    }

    return {
      peek: (section: string) => history[section],
      stickyNavProps: (defaultTo: string, onClick?: (event: MouseEvent<HTMLAnchorElement>) => void) => ({
        to: defaultTo,
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event)
          if (!shouldRestoreStickyUrl(event)) return

          const target = stickyTo(defaultTo)
          if (target === defaultTo) return

          event.preventDefault()
          navigate(target)
        },
      }),
    }
  }, [history, navigate])

  return (
    <SectionHistoryContext.Provider value={value}>
      {children}
    </SectionHistoryContext.Provider>
  )
}

function shouldRestoreStickyUrl(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented
    && event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}
