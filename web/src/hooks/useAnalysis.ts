import { ANALYSIS_QUERY } from '../graphql/queries'
import type { AnalysisInput, AnalysisReport } from '../types/graphql'
import { useEntityQuery } from './useListQuery'

export function useAnalysis(input: AnalysisInput) {
  const { data: report, ...result } = useEntityQuery<AnalysisReport, { input: AnalysisInput }>({ query: ANALYSIS_QUERY, variables: { input } }, 'analysis')
  return { ...result, report }
}
