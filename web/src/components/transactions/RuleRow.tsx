import type { Rule } from '../../types/graphql'
import { ClickableRow } from '../common/ClickableRow'
import { ruleChips, ruleMeta, ruleTitle } from './ruleSummary'

export function RuleRow({ rule, onClick }: { rule: Rule; onClick?: () => void }) {
  return (
    <ClickableRow className="block w-full border-t border-border px-4 py-3.5 text-left transition-colors duration-150 first:border-t-0 enabled:cursor-pointer enabled:hover:bg-raised" onClick={onClick}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold text-text-1">{ruleTitle(rule)}</span>
        <span className="text-xs text-text-muted">{ruleMeta(rule)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ruleChips(rule).map((chip) => (
          <span className="inline-flex max-w-full items-center gap-1 rounded bg-raised px-2 py-0.5 text-xs text-text-2" key={chip.label}>
            <span className="text-text-muted">{chip.label}:</span>
            <span className="truncate">{chip.value}</span>
          </span>
        ))}
      </div>
    </ClickableRow>
  )
}
