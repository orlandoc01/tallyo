import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

export function useQueryParamState(key: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramValue = searchParams.get(key) ?? ''
  const [value, setValue] = useState(paramValue)
  const committedRef = useRef(paramValue)

  // Sync from external URL changes (back/forward, Clear Filters).
  useEffect(() => {
    committedRef.current = paramValue
    setValue(paramValue)
  }, [paramValue])

  const setDraftValue = useCallback((nextValue: string) => {
    setValue(nextValue)
    const trimmed = nextValue.trim()
    if (trimmed === committedRef.current) return
    const startsSession = committedRef.current === '' && trimmed !== ''
    committedRef.current = trimmed
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (trimmed) next.set(key, trimmed)
      else next.delete(key)
      return next
    }, { replace: !startsSession })
  }, [key, setSearchParams])

  return [value, setDraftValue] as const
}
