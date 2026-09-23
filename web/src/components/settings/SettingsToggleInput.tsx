import { ToggleSwitch } from '../common/ToggleSwitch'

export function SettingsToggleInput({ label, checked, dirty, disabled, onChange }: { label: string; checked: boolean; dirty: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-t border-border text-[13px] text-text-2">
      <span>{label}{dirty ? <span aria-hidden="true">*</span> : null}</span>
      <ToggleSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} size="lg" />
    </div>
  )
}
