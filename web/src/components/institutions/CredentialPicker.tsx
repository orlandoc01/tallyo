import type { PlaidCredential } from '../../types/graphql'

export function CredentialPicker({
  credentials,
  onSelect,
  selectedId,
}: {
  credentials: PlaidCredential[]
  onSelect: (credential: PlaidCredential) => void
  selectedId?: number | null
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-neutral-950">Choose Plaid credential</h3>
        <p className="text-sm text-neutral-500">Select which Plaid API credential should own the new connection.</p>
      </div>
      {credentials.map((credential) => {
        const label = credential.label || credential.clientId
        const isSelected = credential.id === selectedId

        return (
          <button
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
              isSelected ? 'border-brand-500 bg-brand-50' : 'border-neutral-200 hover:border-brand-200 hover:bg-neutral-50'
            }`}
            key={credential.id}
            onClick={() => onSelect(credential)}
            type="button"
          >
            <span>
              <span className="block font-semibold text-neutral-950">{label}</span>
              <span className="block text-sm text-neutral-500">{credential.environment.toLowerCase()}</span>
            </span>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600">
              {credential.itemCount} {credential.itemCount === 1 ? 'item' : 'items'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
