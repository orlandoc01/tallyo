import type { AddressDraft, AddressField } from './addressDraft'

const addressInputClass = [
  'mt-1.5 block w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900',
  'placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
].join(' ')

const addressFields: readonly { field: AddressField; label: string; placeholder: string }[] = [
  { field: 'street', label: 'Street', placeholder: '673 Guerrero St' },
  { field: 'city', label: 'City', placeholder: 'San Francisco' },
  { field: 'state', label: 'State', placeholder: 'CA' },
  { field: 'zip', label: 'ZIP', placeholder: '94110' },
]

export function AddressFields({
  address,
  includeHomeType = false,
  onChange,
}: {
  address: AddressDraft
  includeHomeType?: boolean
  onChange: (field: AddressField, value: string) => void
}) {
  const fields = includeHomeType
    ? [...addressFields, { field: 'homeType' as const, label: 'Home type', placeholder: 'Single family' }]
    : addressFields

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map(({ field, label, placeholder }) => (
        <label className="block text-sm font-semibold text-neutral-950" key={field}>
          {label}
          <input
            className={addressInputClass}
            onChange={(e) => onChange(field, e.target.value)}
            placeholder={placeholder}
            type="text"
            value={address[field]}
          />
        </label>
      ))}
    </div>
  )
}
