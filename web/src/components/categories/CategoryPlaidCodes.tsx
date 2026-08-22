import { useState } from 'react'
import { X } from 'lucide-react'
import { useMutation } from 'urql'
import type { Category, CategoryGroup } from '../../types/graphql'
import { UPDATE_CATEGORY_MUTATION } from '../../graphql/mutations'
import { usePlaidPFC2Codes } from '../../hooks/useEntityQueries'

// Self-contained editor for the Plaid PFC2 detailed codes assigned to a category.
// Owns its own fetch/mutation/state; the parent passes the live form values it
// needs to persist alongside the codes and a callback to surface errors.
export function CategoryPlaidCodes({
  category,
  name,
  emoji,
  groupId,
  groups,
  onError,
}: {
  category: Category
  name: string
  emoji: string
  groupId: string
  groups: CategoryGroup[]
  onError: (message: string | null) => void
}) {
  const [plaidCodes, setPlaidCodes] = useState<string[]>(category.plaidPFC2Codes ?? [])
  const [codeFilter, setCodeFilter] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const [savingPFC2, setSavingPFC2] = useState(false)
  const [, updateCategory] = useMutation(UPDATE_CATEGORY_MUTATION)
  const { plaidPFC2Codes } = usePlaidPFC2Codes()

  const assignedCodes = new Map<string, string>()
  for (const group of groups) {
    for (const cat of group.categories) {
      for (const code of cat.plaidPFC2Codes) {
        assignedCodes.set(code, cat.id === category.id ? name : cat.name)
      }
    }
  }
  const filteredCodes = plaidPFC2Codes.filter((code) => code.toLowerCase().includes(codeFilter.toLowerCase()))

  async function updatePlaidCodes(nextCodes: string[]) {
    const previous = plaidCodes
    setPlaidCodes(nextCodes)
    onError(null)
    setSavingPFC2(true)
    try {
      const result = await updateCategory({ input: { id: category.id, name, emoji, groupId, plaidPFC2Codes: nextCodes } })
      if (result.error) throw new Error(result.error.message)
      setSelectedCode('')
    } catch (e) {
      setPlaidCodes(previous)
      onError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setSavingPFC2(false)
    }
  }

  function addSelectedCode() {
    if (!selectedCode || plaidCodes.includes(selectedCode)) return
    if (assignedCodes.has(selectedCode) && assignedCodes.get(selectedCode) !== name) return
    void updatePlaidCodes([...plaidCodes, selectedCode])
  }

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 p-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">Plaid Auto-Categorize</h3>
        <p className="mt-1 text-xs text-neutral-500">Assign PFC2 detailed codes that should default to this category.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {plaidCodes.length ? plaidCodes.map((code) => (
          <span key={code} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
            {code}
            <button
              aria-label={`Remove ${code}`}
              className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-50"
              disabled={savingPFC2}
              onClick={() => updatePlaidCodes(plaidCodes.filter((item) => item !== code))}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )) : <p className="text-xs text-neutral-500">No Plaid codes assigned.</p>}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-neutral-600" htmlFor="pfc2-filter">
          Add PFC2 code
        </label>
        <input
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
          id="pfc2-filter"
          onChange={(e) => setCodeFilter(e.target.value)}
          placeholder="Search Plaid codes"
          value={codeFilter}
        />
        <div className="flex gap-2">
          <select
            aria-label="Plaid PFC2 code"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm"
            onChange={(e) => setSelectedCode(e.target.value)}
            value={selectedCode}
          >
            <option value="">Select a code</option>
            {filteredCodes.map((code) => {
              const assignedTo = assignedCodes.get(code)
              const disabled = plaidCodes.includes(code) || (assignedTo !== undefined && assignedTo !== name)
              return (
                <option disabled={disabled} key={code} value={code}>
                  {code}{assignedTo && assignedTo !== name ? ` - used by ${assignedTo}` : ''}
                </option>
              )
            })}
          </select>
          <button
            className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={!selectedCode || savingPFC2}
            onClick={addSelectedCode}
            type="button"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  )
}
