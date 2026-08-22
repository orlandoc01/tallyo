import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

type ParamUpdates = Record<string, string | null>

// Shared URL search-param writers for the filter hooks. A null value deletes the
// key; any other value sets it. `pushParams` adds a history entry, `replaceParams`
// edits the current one (used while debouncing free-text input).
export function useSearchParamWriters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const write = useCallback((updates: ParamUpdates, replace: boolean) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace })
  }, [setSearchParams])

  const pushParams = useCallback((updates: ParamUpdates) => write(updates, false), [write])
  const replaceParams = useCallback((updates: ParamUpdates) => write(updates, true), [write])

  return { searchParams, pushParams, replaceParams }
}
