import type { Role } from '../../types/graphql'
import type { TagTint } from '../../utils/tagTints'
import { SelectField } from '../common/FormControls'
import { Tag } from '../common/Tag'

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  WRITER: 'Writer',
  READONLY: 'Read only',
  SPEND_TRACKER: 'Spending tracker',
  CASHFLOW_TRACKER: 'Cashflow tracker',
  NET_WORTH_TRACKER: 'Net worth tracker',
  PORTFOLIO_TRACKER: 'Portfolio tracker',
}

const ROLE_TINTS: Record<Role, TagTint> = {
  ADMIN: 'teal',
  WRITER: 'blue',
  READONLY: 'gray',
  SPEND_TRACKER: 'blue',
  CASHFLOW_TRACKER: 'blue',
  NET_WORTH_TRACKER: 'blue',
  PORTFOLIO_TRACKER: 'blue',
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
  return <Tag tint={ROLE_TINTS[role] ?? 'blue'}>{ROLE_LABELS[role] ?? role}</Tag>
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
    <SelectField<Role>
      className="min-w-0"
      disabled={disabled}
      hideLabel={!id}
      id={id}
      label="Role"
      onBlur={onBlur}
      onChange={onChange}
      options={ROLE_OPTIONS}
      value={value}
    />
  )
}
