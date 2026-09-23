import { format, parse } from 'date-fns'
import { Button } from '../common/Button'
import { Card, SelectField } from '../common/FormControls'

function formatMonthLabel(month: string) {
  try {
    return format(parse(month, 'yyyy-MM', new Date()), 'MMMM yyyy')
  } catch {
    return month
  }
}

export function BudgetEmptyMonth({
  availableMonths,
  copying,
  copyFromMonth,
  monthLabel,
  onCopy,
  onCopyFromMonthChange,
  onSetup,
}: {
  availableMonths: string[]
  copying: boolean
  copyFromMonth: string
  monthLabel: string
  onCopy: () => void
  onCopyFromMonthChange: (month: string) => void
  onSetup: () => void
}) {
  return (
    <Card as="section" variant="dashed">
      <h2 className="text-base font-semibold text-text-1">No budget for {monthLabel}</h2>
      <p className="mt-1 text-[13px] text-text-muted">Copy a previous month&apos;s plan or set one up from scratch.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button disabled={copying || !copyFromMonth} onClick={onCopy}>Copy from {formatMonthLabel(copyFromMonth)}</Button>
        <Button onClick={onSetup} variant="secondary">Set up manually</Button>
      </div>
      {availableMonths.length > 1 ? (
        <SelectField
          className="mx-auto mt-3 w-48"
          hideLabel
          label="Month to copy from"
          onChange={onCopyFromMonthChange}
          options={availableMonths.map((month) => ({ label: formatMonthLabel(month), value: month }))}
          value={copyFromMonth}
        />
      ) : null}
    </Card>
  )
}
