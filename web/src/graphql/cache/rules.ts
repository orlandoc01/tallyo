import type { Rule } from '../../types/graphql'
import { RULES_QUERY } from '../queries'
import { invalidateRoot, invalidateRoots, mapCachedList, replaceOrAppendByID, TRANSACTION_ROOTS, type MutationUpdaters, type QueryCache } from './shared'

function sortRules(rules: Rule[]) {
  return [...rules].sort((a, b) => b.priority - a.priority || b.id.localeCompare(a.id))
}

export function upsertRuleInCachedLists(cache: QueryCache, rule: Rule) {
  mapCachedList<Rule>(cache, 'rules', RULES_QUERY, (items) => sortRules(replaceOrAppendByID(items, rule)))
}

export function removeRuleFromCachedLists(cache: QueryCache, ruleID: string) {
  mapCachedList<Rule>(cache, 'rules', RULES_QUERY, (items) => items.filter((rule) => rule.id !== ruleID))
}

export const ruleMutationUpdaters = {
  createRule(result, _args, cache) {
    const rule = (result as { createRule?: { rule?: Rule } }).createRule?.rule
    if (rule) upsertRuleInCachedLists(cache, rule)
    invalidateRoots(cache, ...TRANSACTION_ROOTS)
  },
  updateRule(result, _args, cache) {
    const rule = (result as { updateRule?: { rule?: Rule } }).updateRule?.rule
    if (rule) upsertRuleInCachedLists(cache, rule)
    invalidateRoots(cache, ...TRANSACTION_ROOTS)
  },
  deleteRule(_result, args, cache) {
    const ruleID = typeof args.id === 'string' ? args.id : undefined
    if (ruleID) {
      removeRuleFromCachedLists(cache, ruleID)
    } else {
      invalidateRoot(cache, 'rules')
    }
  },
} satisfies MutationUpdaters
