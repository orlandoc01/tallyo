import { useEffect, useState } from 'react'

function queryMobile() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 1023px)').matches
    : false
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(queryMobile)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}
