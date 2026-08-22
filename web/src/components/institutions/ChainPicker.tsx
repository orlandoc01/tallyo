import { useRef, useState } from 'react'
import { useEVMChains } from '../../hooks/useEntityQueries'
import { useDismiss } from '../../hooks/useDismiss'
import type { EVMChain } from '../../types/graphql'
import { TextField } from '../common/FormControls'
import { PickerShell } from '../common/PickerShell'

export function ChainPicker({ chainIds, onChange }: { chainIds: string[]; onChange: (chainIds: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const { chains, fetching, error } = useEVMChains()
  const selectedChains = chains.filter((chain) => chainIds.includes(chain.id))
  const availableChains = chains.filter((chain) => !chainIds.includes(chain.id))
  const normalizedSearch = search.trim().toLowerCase()
  const visibleChains = normalizedSearch
    ? availableChains.filter((chain) => `${chain.name} ${chain.id}`.toLowerCase().includes(normalizedSearch))
    : availableChains

  useDismiss(isOpen, () => setIsOpen(false), [pickerRef])

  function handleAddChain(chain: EVMChain) {
    onChange([...chainIds, chain.id])
    setSearch('')
    setIsOpen(false)
  }

  return (
    <div className="space-y-3" ref={pickerRef}>
      <div aria-label="Selected chains" className="flex flex-wrap gap-2">
        {selectedChains.map((chain) => (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-sm font-semibold text-neutral-900 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-neutral-100 dark:ring-brand-400/30" key={chain.id}>
            {chain.name}
            <button
              aria-label={`Remove ${chain.name}`}
              className="ml-0.5 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              onClick={() => onChange(chainIds.filter((id) => id !== chain.id))}
              type="button"
            >
              x
            </button>
          </span>
        ))}
        <button
          aria-expanded={isOpen}
          className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={fetching || !!error}
          onClick={() => setIsOpen((open) => !open)}
          type="button"
        >
          + Chain
        </button>
      </div>

      {fetching ? <p className="text-sm text-neutral-500" role="status">Loading chains…</p> : null}
      {error ? <p className="text-sm text-red-600">Could not load chains.</p> : null}
      {isOpen && !fetching && !error ? (
        <PickerShell onClose={() => setIsOpen(false)}>
          <TextField autoFocus hideLabel label="Search chains" onChange={setSearch} placeholder="Search chains" type="search" value={search} />
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
            {visibleChains.map((chain) => (
              <button key={chain.id} type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-base hover:bg-neutral-50" onClick={() => handleAddChain(chain)}>
                <span>{chain.name}</span>
                <span className="text-xs font-semibold text-neutral-500">{chain.id}</span>
              </button>
            ))}
            {availableChains.length === 0 ? <div className="px-3 py-2 text-sm text-neutral-500">All supported chains are selected.</div> : null}
            {availableChains.length > 0 && visibleChains.length === 0 ? <div className="px-3 py-2 text-sm text-neutral-500">No chains match your search.</div> : null}
          </div>
        </PickerShell>
      ) : null}
    </div>
  )
}
