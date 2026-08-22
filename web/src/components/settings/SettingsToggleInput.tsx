import { ToggleSwitch } from '../common/ToggleSwitch'

export function SettingsToggleInput({ label, checked, dirty, disabled, onChange }: { label: string; checked: boolean; dirty: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm font-semibold text-neutral-700">
      <span>{label}{dirty ? <span aria-hidden="true">*</span> : null}</span>
      <ToggleSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  )
}
