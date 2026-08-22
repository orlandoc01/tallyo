import { AlertCircle } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'

import { Button } from '../common/Button'
import { ErrorState } from '../common/ErrorState'
import { Card, SectionLabel } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { Configuration } from '../../types/graphql'

// Shared form primitives for the settings configuration tabs (runtime,
// security). A dirty field is marked with a trailing asterisk; an optional
// warning shows an inline icon with a tooltip.

function LabelText({ label, dirty, warning }: { label: string; dirty: boolean; warning?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {warning ? <span title={warning}><AlertCircle className="h-4 w-4 shrink-0 text-amber-500" /></span> : null}
      {label}
      {dirty ? <span aria-hidden="true">*</span> : null}
    </span>
  )
}

export function ToggleInput({ label, checked, dirty, warning, onChange }: { label: string; checked: boolean; dirty: boolean; warning?: string; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <LabelText dirty={dirty} label={label} warning={warning} />
      <ToggleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}

export function TextInput({ label, value, dirty, disabled, placeholder, onChange }: { label: string; value: string; dirty: boolean; disabled?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <label className={`block text-sm font-semibold ${disabled ? 'text-neutral-400' : 'text-neutral-700'}`}>
      <LabelText dirty={dirty} label={label} />
      <input
        className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm transition-colors ${disabled ? 'cursor-not-allowed border-neutral-100 bg-neutral-50 text-neutral-400' : 'border-neutral-200 text-neutral-950'}`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}

export function ConfigStatus({
  configuration,
  error,
  fetching,
  mutationError,
}: {
  configuration: Configuration | null | undefined
  error?: { message: string }
  fetching: boolean
  mutationError?: { message: string }
}) {
  return (
    <>
      <QueryGate
        data={fetching ? undefined : configuration}
        empty={!configuration}
        emptyTitle="No configuration"
        emptyDescription="No server configuration was returned."
        error={error}
        fetching={fetching}
      />
      {mutationError ? <ErrorState message={mutationError.message} /> : null}
    </>
  )
}

export function ConfigCardFooter({ disabled }: { disabled: boolean }) {
  return (
    <div className="flex items-center justify-end border-t border-neutral-200 px-4 py-3">
      <Button disabled={disabled} type="submit">save</Button>
    </div>
  )
}

export function ConfigCard({ title, disabled, dirty, inactive, inactiveReason, onSubmit, children }: { title: string; disabled: boolean; dirty: boolean; inactive?: boolean; inactiveReason?: string; onSubmit: () => void; children: ReactNode }) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Card as="form" compact onSubmit={handleSubmit}>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel as="h3">{title}</SectionLabel>
          {inactive && inactiveReason ? <span className="text-xs text-neutral-400">{inactiveReason}</span> : null}
        </div>
        <div className={`space-y-4${inactive ? ' pointer-events-none select-none opacity-40' : ''}`}>
          {children}
        </div>
      </div>
      {dirty && !inactive ? <ConfigCardFooter disabled={disabled} /> : null}
    </Card>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function pickDirtyFields<T>(dirtyFields: Set<T>, keys: T[]) {
  return new Set(keys.filter((key) => dirtyFields.has(key)))
}
