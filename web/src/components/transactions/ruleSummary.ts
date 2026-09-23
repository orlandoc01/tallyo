import type { Rule } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { formatSignedCurrency } from '../../utils/currency'

export function ruleTitle(rule: Rule) {
  return rule.merchantPattern || rule.originalPattern || 'Rule'
}

export function ruleMeta(rule: Rule) {
  const category = rule.category
    ? [`${rule.category.emoji} ${rule.category.name}`, rule.category.groupName ? `${rule.category.groupEmoji ?? ''} ${rule.category.groupName}`.trim() : null]
    : ['No category']
  return [...category.filter(Boolean), `Priority ${rule.priority}`].join(' · ')
}

export function ruleChips(rule: Rule): Array<{ label: string; value: string }> {
  return [
    { label: 'Merchant', value: rule.merchantPattern || 'Any' },
    { label: 'Original name', value: rule.originalPattern || 'Any' },
    { label: 'Rename merchant', value: rule.merchantName || 'No' },
    { label: 'Amount', value: formatAmountRange(rule) },
    { label: 'Accounts', value: rule.accounts?.length ? rule.accounts.map(accountDisplayLabel).join(', ') : 'Any' },
    { label: 'Tags', value: rule.tags?.length ? rule.tags.map((tag) => `#${tag.name}`).join(', ') : 'None' },
    { label: 'Hide', value: formatOptionalBoolean(rule.shouldHide) },
    { label: 'Recurring', value: formatOptionalBoolean(rule.shouldBeRecurring) },
    { label: 'Created', value: formatDate(rule.createdAt) },
  ]
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

function formatOptionalBoolean(value: boolean | null | undefined) {
  if (value == null) return 'No change'
  return value ? 'Yes' : 'No'
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}
