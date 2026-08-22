import { useContext } from 'react'
import { SectionHistoryContext, type SectionHistoryContextValue } from './sectionHistoryContext'

export function useSectionHistory(): SectionHistoryContextValue {
  const ctx = useContext(SectionHistoryContext)
  if (!ctx) {
    throw new Error('useSectionHistory must be used within a SectionHistoryProvider')
  }
  return ctx
}
