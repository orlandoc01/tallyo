import { useState } from 'react'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { filterSummary } from '../common/filterSummary'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { SegmentedControl } from '../common/SegmentedControl'
import { useCategoryGroups } from '../../hooks/useEntityQueries'
import { defaultDateRangeForSpendingTab, type SpendingFilterTab } from '../../hooks/useSpendingFilterParams'
import type { Granularity } from '../../types/graphql'
import { MobileCategoryChecklist } from './CategoryFilter'
import { DateRangeInputs } from './DateRangeSelector'
import { OwnerFilterSection } from './OwnerFilterDropdown'
import { ReportFilterSection } from './ReportFilterDropdown'

export interface ReportsPendingFilter {
  dateFrom: string
  dateTo: string
  categoryIds: string[]
  ownerIds: string[]
}

// Mobile filter overlay for the Reports page. Date range, categories, and
// owners are staged locally until Apply; the view toggles (grouping, chart
// type, period) commit immediately, matching the desktop toolbar. The overlay
// unmounts when closed, so the staged state resets naturally.
export function ReportsMobileFilters({
  activeTab,
  breakdownView,
  categoryIds,
  dateFrom,
  dateTo,
  granularity,
  groupBy,
  ownerIds,
  trendsView,
  onApply,
  onBreakdownViewChange,
  onClear,
  onClose,
  onGranularityChange,
  onGroupByChange,
  onTrendsViewChange,
}: {
  activeTab: SpendingFilterTab
  breakdownView: 'bar' | 'pie'
  categoryIds: string[]
  dateFrom: string
  dateTo: string
  granularity: Granularity
  groupBy: 'category' | 'group'
  ownerIds: string[]
  trendsView: 'stacked' | 'line'
  onApply: (pending: ReportsPendingFilter) => void
  onBreakdownViewChange: (view: 'bar' | 'pie') => void
  onClear: () => void
  onClose: () => void
  onGranularityChange: (granularity: Granularity) => void
  onGroupByChange: (groupBy: 'category' | 'group') => void
  onTrendsViewChange: (view: 'stacked' | 'line') => void
}) {
  const { categoryGroups } = useCategoryGroups()
  const [pendingDateFrom, setPendingDateFrom] = useState(dateFrom)
  const [pendingDateTo, setPendingDateTo] = useState(dateTo)
  const [pendingCategoryIds, setPendingCategoryIds] = useState(categoryIds)
  const [pendingOwners, setPendingOwners] = useState(ownerIds)
  const [categoriesOpen, setCategoriesOpen] = useState(false)

  const defaultDateRange = defaultDateRangeForSpendingTab(activeTab, granularity)
  const pendingDateRangeFiltered = activeTab !== 'comparison' && (pendingDateFrom !== defaultDateRange.dateFrom || pendingDateTo !== defaultDateRange.dateTo)

  return (
    <MobileFilterDropdown
      bodyClassName="space-y-6"
      footer={(
        <MobileFilterFooter
          onPrimary={() => onApply({ dateFrom: pendingDateFrom, dateTo: pendingDateTo, categoryIds: pendingCategoryIds, ownerIds: pendingOwners })}
          onSecondary={onClear}
        />
      )}
      labelledBy="reports-filters-title"
      onClose={onClose}
    >
      {activeTab !== 'comparison' ? (
        <ReportFilterSection active={pendingDateRangeFiltered}>
          <DateRangeInputs
            dateFrom={pendingDateFrom}
            dateTo={pendingDateTo}
            layout="compact"
            onChange={(next) => { setPendingDateFrom(next.dateFrom); setPendingDateTo(next.dateTo) }}
          />
        </ReportFilterSection>
      ) : null}
      {activeTab !== 'comparison' ? (
        <MobileToggleGroup
          options={[{ value: 'category', label: 'By category' }, { value: 'group', label: 'By group' }]}
          title="Grouping"
          value={groupBy}
          onChange={onGroupByChange}
        />
      ) : null}
      {activeTab === 'breakdown' ? (
        <MobileToggleGroup
          options={[{ value: 'bar', label: 'Bars' }, { value: 'pie', label: 'Pie' }]}
          title="Chart type"
          value={breakdownView}
          onChange={onBreakdownViewChange}
        />
      ) : null}
      {activeTab === 'trends' ? (
        <>
          <MobileToggleGroup
            options={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'YEARLY', label: 'Yearly' }]}
            title="Period"
            value={granularity}
            onChange={onGranularityChange}
          />
          <MobileToggleGroup
            options={[{ value: 'stacked', label: 'Stacked' }, { value: 'line', label: 'Line' }]}
            title="Chart type"
            value={trendsView}
            onChange={onTrendsViewChange}
          />
        </>
      ) : null}
      <OwnerFilterSection onChange={setPendingOwners} selectedOwners={pendingOwners} />
      <CollapsibleFilterSection active={pendingCategoryIds.length > 0} expanded={categoriesOpen} label="Categories" summary={filterSummary(pendingCategoryIds.length)} onToggle={() => setCategoriesOpen((open) => !open)}>
        <MobileCategoryChecklist
          categoryGroups={categoryGroups}
          onChange={setPendingCategoryIds}
          selectedCategoryIds={pendingCategoryIds}
        />
      </CollapsibleFilterSection>
    </MobileFilterDropdown>
  )
}

function MobileToggleGroup<T extends string>({
  options,
  title,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  title: string
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-neutral-700">{title}</h3>
      <SegmentedControl ariaLabel={title} onChange={onChange} options={options} value={value} />
    </div>
  )
}
