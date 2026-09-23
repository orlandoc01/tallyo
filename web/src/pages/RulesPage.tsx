import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery } from 'urql'
import { Button } from '../components/common/Button'
import { FiltersButton } from '../components/common/FiltersButton'
import { Card, SearchInput } from '../components/common/FormControls'
import { MobileFilterButton } from '../components/common/MobileFilterDropdown'
import { QueryGate } from '../components/common/QueryGate'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { SettingsTitleRow } from '../components/settings/SettingsTitleRow'
import { CreateRuleModal } from '../components/transactions/CreateRuleModal'
import { EditRuleModal } from '../components/transactions/EditRuleModal'
import { RuleFilterPanel, RuleMobileFilters } from '../components/transactions/RuleFilterPanel'
import { RuleRow } from '../components/transactions/RuleRow'
import { countActiveRuleFilters, type RuleFilterValues } from '../components/transactions/ruleFilterUtils'
import { RULES_QUERY } from '../graphql/queries'
import { useAccounts, useCategoryGroups } from '../hooks/useEntityQueries'
import { useFilterCaretRight } from '../hooks/useFilterCaretRight'
import { usePermissions } from '../hooks/usePermissions'
import { useQueryParamState } from '../hooks/useQueryParamState'
import type { Rule, RulesInput } from '../types/graphql'

type LocalRuleFilters = Pick<RuleFilterValues, 'accountIds' | 'amountMin' | 'amountMax'>

const emptyLocalRuleFilters: LocalRuleFilters = { accountIds: [], amountMin: '', amountMax: '' }

export function RulesPage() {
  const [merchantPattern, setMerchantPattern] = useQueryParamState('merchant_pattern')
  const [originalPattern, setOriginalPattern] = useQueryParamState('original_pattern')
  const [search, setSearch] = useQueryParamState('q')
  const [localFilters, setLocalFilters] = useState(emptyLocalRuleFilters)
  const filters = useMemo<RuleFilterValues>(() => ({ merchantPattern, originalPattern, search, ...localFilters }), [merchantPattern, originalPattern, search, localFilters])
  const rulesInput = useMemo(() => rulesInputFromFilters(filters), [filters])
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ rules: { items: Rule[] } }, { input: RulesInput | null }>({ query: RULES_QUERY, variables: { input: rulesInput } })
  const { rule_id: ruleID } = useParams()
  const navigate = useNavigate()
  const { canWrite } = usePermissions()
  const rules = useMemo(() => data?.rules.items ?? [], [data?.rules.items])
  const editingRule = ruleID && !fetching ? rules.find((rule) => rule.id === ruleID) ?? null : null
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const caretRight = useFilterCaretRight(filtersOpen, filtersButtonRef, pageRef)
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const canWriteRules = canWrite('rules')
  const activeFilterCount = countActiveRuleFilters(filters)
  const panelFilterCount = activeFilterCount - (search.trim() ? 1 : 0)

  const updateFilters = useCallback((updates: Partial<RuleFilterValues>) => {
    if (updates.merchantPattern !== undefined) setMerchantPattern(updates.merchantPattern)
    if (updates.originalPattern !== undefined) setOriginalPattern(updates.originalPattern)
    if (updates.accountIds !== undefined || updates.amountMin !== undefined || updates.amountMax !== undefined) {
      setLocalFilters((current) => ({ ...current, ...localRuleFilterUpdates(updates) }))
    }
  }, [setMerchantPattern, setOriginalPattern])

  const clearFilters = useCallback(() => {
    setMerchantPattern('')
    setOriginalPattern('')
    setSearch('')
    setLocalFilters(emptyLocalRuleFilters)
  }, [setMerchantPattern, setOriginalPattern, setSearch])

  const mobileHeaderActions = useMemo(() => (
    <>
      <MobileFilterButton active={mobileFiltersOpen} ariaLabel="Open rule filters" count={panelFilterCount} onClick={() => setMobileFiltersOpen((open) => !open)} />
      {canWriteRules ? <Button aria-label="Create rule" onClick={() => setShowCreateModal(true)}>+ Add</Button> : null}
    </>
  ), [canWriteRules, mobileFiltersOpen, panelFilterCount])
  useMobileHeaderActions(mobileHeaderActions)

  function handleRuleUpdatedOrDeleted() {
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  function closeRule() {
    if (ruleID) navigate('/settings/rules')
  }

  return (
    <div className="flex flex-col gap-3" ref={pageRef}>
      <SettingsTitleRow action={canWriteRules ? <Button aria-label="Add rule" onClick={() => setShowCreateModal(true)}>+ Add</Button> : null} title="Rules" />
      <div className="flex items-center gap-2">
        <SearchInput ariaLabel="Search rules" className="w-full lg:max-w-[360px]" onChange={setSearch} placeholder="Search rules..." value={search} />
        <div className="hidden lg:block">
          <FiltersButton count={panelFilterCount} onClick={() => setFiltersOpen((open) => !open)} open={filtersOpen} ref={filtersButtonRef} />
        </div>
      </div>
      {filtersOpen ? (
        <div className="hidden lg:block">
          <RuleFilterPanel accounts={accounts} caretRight={caretRight} clearable={panelFilterCount > 0} filters={filters} onChange={updateFilters} onClear={clearFilters} />
        </div>
      ) : null}
      <QueryGate
        data={data}
        empty={rules.length === 0}
        emptyTitle={activeFilterCount ? 'No matching rules' : 'No rules yet'}
        emptyDescription={activeFilterCount ? 'Adjust or clear the rule filters to see more automation rules.' : 'Create rules from the review queue after categorizing transactions.'}
        error={error}
        errorPrefix="Failed to load rules"
        fetching={fetching}
        onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
      >
        <Card as="section">
          {rules.map((rule) => (
            <RuleRow key={rule.id} onClick={canWriteRules ? () => navigate(`/settings/rules/${rule.id}`) : undefined} rule={rule} />
          ))}
        </Card>
      </QueryGate>
      {mobileFiltersOpen ? (
        <RuleMobileFilters accounts={accounts} filters={filters} onChange={updateFilters} onClear={clearFilters} onClose={() => setMobileFiltersOpen(false)} />
      ) : null}
      {editingRule ? (
        <EditRuleModal
          rule={editingRule}
          onClose={closeRule}
          onUpdated={handleRuleUpdatedOrDeleted}
          onDeleted={handleRuleUpdatedOrDeleted}
        />
      ) : null}
      {showCreateModal ? (
        <CreateRuleModal
          accounts={accounts}
          categoryGroups={categoryGroups}
          filter={{ isHidden: false }}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleRuleUpdatedOrDeleted}
        />
      ) : null}
    </div>
  )
}

function localRuleFilterUpdates(updates: Partial<RuleFilterValues>): Partial<LocalRuleFilters> {
  return {
    ...(updates.accountIds !== undefined ? { accountIds: updates.accountIds } : {}),
    ...(updates.amountMin !== undefined ? { amountMin: updates.amountMin } : {}),
    ...(updates.amountMax !== undefined ? { amountMax: updates.amountMax } : {}),
  }
}

function rulesInputFromFilters(filters: RuleFilterValues): RulesInput | null {
  const input: RulesInput = {}
  const merchantPattern = filters.merchantPattern.trim()
  const originalPattern = filters.originalPattern.trim()
  const search = filters.search.trim()
  const amountMin = optionalNumber(filters.amountMin)
  const amountMax = optionalNumber(filters.amountMax)
  if (merchantPattern) input.merchantPattern = merchantPattern
  if (originalPattern) input.originalPattern = originalPattern
  if (search) input.search = search
  if (filters.accountIds.length) input.accountIds = filters.accountIds
  if (amountMin !== undefined) input.amountMin = amountMin
  if (amountMax !== undefined) input.amountMax = amountMax
  return Object.keys(input).length ? input : null
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}
