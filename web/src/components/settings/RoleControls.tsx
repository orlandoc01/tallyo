import type { Role } from '../../types/graphql'

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  WRITER: 'Writer',
  READONLY: 'Read only',
  SPEND_TRACKER: 'Spending tracker',
  CASHFLOW_TRACKER: 'Cashflow tracker',
  NET_WORTH_TRACKER: 'Net worth tracker',
  PORTFOLIO_TRACKER: 'Portfolio tracker',
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'WRITER', label: 'Writer' },
  { value: 'READONLY', label: 'Read only' },
  { value: 'SPEND_TRACKER', label: 'Spending tracker' },
  { value: 'CASHFLOW_TRACKER', label: 'Cashflow tracker' },
  { value: 'NET_WORTH_TRACKER', label: 'Net worth tracker' },
  { value: 'PORTFOLIO_TRACKER', label: 'Portfolio tracker' },
  { value: 'ADMIN', label: 'Admin' },
]

export function RoleBadge({ role }: { role: Role }) {
  const label = ROLE_LABELS[role] ?? role
  if (role === 'ADMIN') {
    return <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{label}</span>
  }
  if (role === 'READONLY') {
    return <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">{label}</span>
  }
  return <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">{label}</span>
}

export function RoleSelect({
  id,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  id?: string
  value: Role
  onChange: (role: Role) => void
  onBlur?: () => void
  disabled?: boolean
}) {
  return (
    <select
      className="rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
      disabled={disabled}
      id={id}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value as Role)}
      value={value}
    >
      {ROLE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
