import { useEffect } from 'react'
import { useMobileHeader } from '../components/layout/useMobileHeader'

export function useFiltersActive(count: number) {
  const { setFiltersActive } = useMobileHeader()

  useEffect(() => {
    setFiltersActive(count > 0)
    return () => setFiltersActive(false)
  }, [count, setFiltersActive])
}
