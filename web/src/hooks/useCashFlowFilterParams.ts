import { getLastThreePeriodDateRange } from '../utils/dates'
import { useReportFilterParamCore } from './useReportFilterParamCore'

const CASH_FLOW_DATE_KEYS = { from: 'start_date', to: 'end_date' }

export function useCashFlowFilterParams() {
  const core = useReportFilterParamCore({
    dateParamKeys: CASH_FLOW_DATE_KEYS,
    defaultDateRangeForGranularity: getLastThreePeriodDateRange,
  })

  return {
    dateFrom: core.dateFrom, setDateFrom: core.setDateFrom,
    dateTo: core.dateTo, setDateTo: core.setDateTo,
    granularity: core.granularity, setGranularity: core.setGranularity,
    ownerIds: core.ownerIds, setOwnerIds: core.setOwnerIds,
    setMany: core.setMany,
    filter: core.filter,
  }
}
