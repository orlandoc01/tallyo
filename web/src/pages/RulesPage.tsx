import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery } from 'urql'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { Card, SectionLabel } from '../components/common/FormControls'
import { mobileHeaderActionClass } from '../components/common/mobileHeaderActionClass'
import { QueryGate } from '../components/common/QueryGate'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { CreateRuleModal } from '../components/transactions/CreateRuleModal'
import { EditRuleModal } from '../components/transactions/EditRuleModal'
import { RuleFiltersDropdown } from '../components/transactions/RuleFiltersDropdown'
import { countActiveRuleFilters, type RuleFilterValues } from '../components/transactions/ruleFilterUtils'
import { RULES_QUERY } from '../graphql/queries'
import { useAccounts, useCategoryGroups } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import { useQueryParamState } from '../hooks/useQueryParamState'
import type { Rule, RulesInput } from '../types/graphql'
import { accountDisplayLabel } from '../utils/accounts'
import { formatSignedCurrency } from '../utils/currency'

type LocalRuleFilters = Pick<RuleFilterValues, 'accountIds' | 'amountMin' | 'amountMax'>

const emptyLocalRuleFilters: LocalRuleFilters = { accountIds: [], amountMin: '', amountMax: '' }

export function RulesPage() {
  const [merchantPattern, setMerchantPattern] = useQueryParamState('merchant_pattern')
  const [originalPattern, setOriginalPattern] = useQueryParamState('original_pattern')
  const [localFilters, setLocalFilters] = useState(emptyLocalRuleFilters)
  const filters = useMemo<RuleFilterValues>(() => ({ merchantPattern, originalPattern, ...localFilters }), [merchantPattern, originalPattern, localFilters])
  const rulesInput = useMemo(() => rulesInputFromFilters(filters), [filters])
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ rules: { items: Rule[] } }, { input: RulesInput | null }>({ query: RULES_QUERY, variables: { input: rulesInput } })
  const { rule_id: ruleID } = useParams()
  const navigate = useNavigate()
  const { canWrite } = usePermissions()
  const rules = useMemo(() => data?.rules.items ?? [], [data?.rules.items])
  const editingRule = ruleID && !fetching ? rules.find((rule) => rule.id === ruleID) ?? null : null
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const canWriteRules = canWrite('rules')
  const activeFilterCount = countActiveRuleFilters(filters)

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
    setLocalFilters(emptyLocalRuleFilters)
  }, [setMerchantPattern, setOriginalPattern])

  const mobileHeaderActions = useMemo(() => {
    return (
      <>
        <RuleFiltersDropdown
          accounts={accounts}
          buttonAriaLabel="Open rule filters"
          buttonClassName={mobileHeaderActionClass('touch-manipulation rounded-2xl p-2.5')}
          buttonContent={<SlidersHorizontal className="h-5 w-5" />}
          filters={filters}
          onChange={updateFilters}
          onClear={clearFilters}
        />
        {canWriteRules ? (
          <button
            aria-label="Create rule"
            className={mobileHeaderActionClass('inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-2xl', showCreateModal)}
            onClick={() => setShowCreateModal(true)}
            type="button"
          >
            <Plus className="h-5 w-5" />
          </button>
        ) : null}
      </>
    )
  }, [accounts, canWriteRules, clearFilters, filters, showCreateModal, updateFilters])

  useMobileHeaderActions(mobileHeaderActions)

  function handleRuleUpdatedOrDeleted() {
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  function openRule(rule: Rule) {
    navigate(`/settings/rules/${rule.id}`)
  }

  function closeRule() {
    if (ruleID) navigate('/settings/rules')
  }

  return (
    <div className="space-y-6">
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <SectionLabel>Rules</SectionLabel>
        <div className="flex items-center gap-2">
          <RuleFiltersDropdown accounts={accounts} filters={filters} onChange={updateFilters} onClear={clearFilters} />
          {canWriteRules ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-600 bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm"
              onClick={() => setShowCreateModal(true)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          ) : null}
        </div>
      </div>
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
        <Card>
          {rules.map((rule) => (
            <div
              className={`flex flex-col gap-4 border-b border-neutral-100 p-4 md:flex-row md:items-start md:justify-between ${canWriteRules ? 'cursor-pointer hover:bg-neutral-50' : ''}`}
              key={rule.id}
              onClick={canWriteRules ? () => openRule(rule) : undefined}
              role={canWriteRules ? 'button' : undefined}
              tabIndex={canWriteRules ? 0 : undefined}
              onKeyDown={canWriteRules ? (e) => { if (e.key === 'Enter' || e.key === ' ') openRule(rule) } : undefined}
            >
              <div className="space-y-3">
                <div>
                  <div className="font-semibold">{rule.merchantPattern || rule.originalPattern || 'Rule'}</div>
                  <div className="text-sm text-neutral-500">
                    {rule.category ? `${rule.category.emoji} ${rule.category.name} · ${rule.category.groupEmoji ?? ''} ${rule.category.groupName ?? ''}` : 'No category'}
                    {formatTags(rule) ? ` · ${formatTags(rule)}` : ''} · Priority {rule.priority}
                    {rule.shouldHide ? ' · Hide matches' : ''}
                    {rule.shouldBeRecurring != null ? ` · Recurring: ${rule.shouldBeRecurring ? 'Yes' : 'No'}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <RuleDetail label="Merchant" value={rule.merchantPattern || 'Any'} />
                  <RuleDetail label="Original name" value={rule.originalPattern || 'Any'} />
                  <RuleDetail label="Rename merchant" value={rule.merchantName || 'No'} />
                  <RuleDetail label="Amount" value={formatAmountRange(rule)} />
                  <RuleDetail label="Accounts" value={formatAccounts(rule)} />
                  <RuleDetail label="Tags" value={formatTags(rule) || 'None'} />
                  <RuleDetail label="Hide" value={formatOptionalBoolean(rule.shouldHide)} />
                  <RuleDetail label="Recurring" value={formatOptionalBoolean(rule.shouldBeRecurring)} />
                  <RuleDetail label="Created" value={formatDate(rule.createdAt)} />
                </div>
              </div>
              {canWriteRules ? (
                <div className="self-start rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500">
                  Click to edit
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      </QueryGate>
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
  const amountMin = optionalNumber(filters.amountMin)
  const amountMax = optionalNumber(filters.amountMax)
  if (merchantPattern) input.merchantPattern = merchantPattern
  if (originalPattern) input.originalPattern = originalPattern
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

interface RuleDetailProps {
  label: string
  value: string
}

function RuleDetail({ label, value }: RuleDetailProps) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-neutral-700">
      <span className="font-semibold text-neutral-500">{label}:</span> {value}
    </span>
  )
}

function formatAmountRange(rule: Rule) {
  if (rule.amountMin == null && rule.amountMax == null) return 'Any'
  if (rule.amountMin != null && rule.amountMax != null) {
    return rule.amountMin === rule.amountMax
      ? formatSignedCurrency(rule.amountMin)
      : `${formatSignedCurrency(rule.amountMin)} to ${formatSignedCurrency(rule.amountMax)}`
  }
  return rule.amountMin != null ? `At least ${formatSignedCurrency(rule.amountMin)}` : `Up to ${formatSignedCurrency(rule.amountMax ?? 0)}`
}

function formatAccounts(rule: Rule) {
  if (!rule.accounts?.length) return 'Any'
  return rule.accounts.map(accountDisplayLabel).join(', ')
}

function formatTags(rule: Rule) {
  if (!rule.tags?.length) return ''
  return rule.tags.map((tag) => `#${tag.name}`).join(', ')
}

function formatOptionalBoolean(value: boolean | null | undefined) {
  if (value == null) return 'No change'
  return value ? 'Yes' : 'No'
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}
