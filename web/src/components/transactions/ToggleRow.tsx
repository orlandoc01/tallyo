export function ToggleRow({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean
  label: string
  onChange: (value: boolean) => void
  value: boolean
}) {
  return (
    <button
      aria-checked={value}
      className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={() => onChange(!value)}
      role="switch"
      type="button"
    >
      <span className="font-medium text-neutral-700">{label}</span>
      <span
        className={`inline-flex h-6 w-10 items-center rounded-full px-0.5 transition ${value ? 'bg-brand-500' : 'bg-neutral-300'}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
    </button>
  )
}
