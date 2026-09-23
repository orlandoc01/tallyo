import type { DonutSlice } from '../common/Donut'
import type { AnalysisSlice, AnalysisView } from '../../types/graphql'
import type { AccountGroupId } from '../../utils/accountGroups'
import { analysisSliceColor } from './analysisSliceColor'

export const PORTFOLIO_VIEW_PARAMS = ['composition', 'category', 'group', 'sectors'] as const
export type PortfolioViewParam = typeof PORTFOLIO_VIEW_PARAMS[number]

export const PORTFOLIO_VIEWS: ReadonlyArray<{ param: PortfolioViewParam; view: AnalysisView; label: string }> = [
  { param: 'composition', view: 'COMPOSITION', label: 'Composition' },
  { param: 'category', view: 'MORNINGSTAR_CATEGORY', label: 'Category' },
  { param: 'group', view: 'MORNINGSTAR_GROUP', label: 'Group' },
  { param: 'sectors', view: 'SECTORS', label: 'Sectors' },
]

export const PORTFOLIO_VIEW_OPTIONS = PORTFOLIO_VIEWS.map((option) => ({ value: option.param, label: option.label }))

export function portfolioViewOption(param: PortfolioViewParam) {
  return PORTFOLIO_VIEWS.find((option) => option.param === param) ?? PORTFOLIO_VIEWS[0]
}

export const UNCLASSIFIED_NOTE = 'Analysis data not yet available for these holdings.'

export const MIN_DONUT_SHARE = 0.004

export function donutSlices(slices: AnalysisSlice[], totalValueUSD: number): DonutSlice[] {
  const floor = totalValueUSD * MIN_DONUT_SHARE
  return slices.map((slice, index) => ({
    key: slice.label,
    label: slice.label,
    value: slice.valueUSD > 0 && slice.valueUSD < floor ? floor : Math.max(slice.valueUSD, 0),
    color: analysisSliceColor(slice.label, index),
  }))
}

export interface PortfolioFilters {
  ownerIds: string[]
  accountGroupIds: AccountGroupId[]
  accountIds: string[]
  includeUnclassified: boolean
}

export function portfolioFilterCount(filters: PortfolioFilters) {
  return filters.ownerIds.length + filters.accountGroupIds.length + filters.accountIds.length + (filters.includeUnclassified ? 1 : 0)
}
