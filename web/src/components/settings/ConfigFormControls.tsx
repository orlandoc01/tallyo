import { AlertCircle } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'

import { Button } from '../common/Button'
import { ErrorState } from '../common/ErrorState'
import { Card, SectionLabel, TextField } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { Configuration } from '../../types/graphql'

// Shared form primitives for the settings configuration tabs (runtime,
// security). A dirty field is marked with a trailing asterisk; an optional
// warning shows an inline icon with a tooltip.

function LabelText({ label, dirty, warning }: { label: string; dirty: boolean; warning?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {warning ? <span title={warning}><AlertCircle className="h-4 w-4 shrink-0 text-warning" /></span> : null}
      {label}
      {dirty ? <span aria-hidden="true">*</span> : null}
    </span>
  )
}

export type ToggleInputProps = { label: string; checked: boolean; dirty: boolean; warning?: string; onChange: (value: boolean) => void }

export function ToggleInput({ label, checked, dirty, warning, onChange }: ToggleInputProps) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-text-2">
      <LabelText dirty={dirty} label={label} warning={warning} />
      <ToggleSwitch checked={checked} label={label} onChange={onChange} size="lg" />
    </div>
  )
}

export function TextInput({ label, value, dirty, disabled, placeholder, onChange }: { label: string; value: string; dirty: boolean; disabled?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <TextField
      disabled={disabled}
      label={label}
      labelSuffix={dirty ? <span aria-hidden="true">*</span> : null}
      mono
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
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
    <div className="flex items-center justify-end border-t border-border px-4 py-3">
      <Button disabled={disabled} type="submit">save</Button>
    </div>
  )
}

export function ConfigCard({ title, disabled, dirty, enabled, inactive, inactiveReason, onSubmit, children }: {
  title: string
  disabled: boolean
  dirty: boolean
  enabled?: ToggleInputProps
  inactive?: boolean
  inactiveReason?: string
  onSubmit: () => void
  children: ReactNode
}) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Card as="form" className="self-start" onSubmit={handleSubmit}>
      <div className="space-y-3.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel as="h3">{title}</SectionLabel>
            {enabled ? <p className="mt-0.5 text-xs text-text-muted"><LabelText dirty={enabled.dirty} label={enabled.label} warning={enabled.warning} /></p> : null}
            {inactive && inactiveReason ? <p className="mt-0.5 text-xs text-text-faint">{inactiveReason}</p> : null}
          </div>
          {enabled ? <ToggleSwitch checked={enabled.checked} disabled={inactive} label={enabled.label} onChange={enabled.onChange} size="lg" /> : null}
        </div>
        <div className={`space-y-3.5${inactive ? ' pointer-events-none select-none opacity-40' : ''}`}>
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
