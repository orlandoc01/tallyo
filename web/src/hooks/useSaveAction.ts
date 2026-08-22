import { useState } from 'react'

type MutationResult = { error?: { message: string } | null }

export function useSaveAction() {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save<T extends MutationResult>(runMutation: () => Promise<T>, onSaved: (result: T) => void) {
    setError(null)
    setSaving(true)
    try {
      const result = await runMutation()
      if (result.error) throw new Error(result.error.message)
      onSaved(result)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return { error, saving, save, setError }
}
