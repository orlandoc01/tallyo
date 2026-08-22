import { useContext, useEffect, useState } from 'react'
import { deletePasskey, listPasskeys, renamePasskey, runPasskeyRegistration, type PasskeyCredential } from '../../auth/webauthn'
import { AuthContext } from '../../auth/authContextValue'
import { FormError } from '../common/FormControls'
import { Modal } from '../common/Modal'

export function SecurityTab() {
  const [items, setItems] = useState<PasskeyCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(() => new URLSearchParams(window.location.search).get('onboarding') === 'passkey')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const auth = useContext(AuthContext)
  const emailAuthEnabled = auth?.emailAuthEnabled ?? true
  const googleAuthEnabled = auth?.googleAuthEnabled ?? true
  const webauthnEnabled = auth?.webauthnEnabled ?? false
  const passkeyOnly = webauthnEnabled && !emailAuthEnabled && !googleAuthEnabled
  const blocking = passkeyOnly && !loading && items.length === 0

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setItems(await listPasskeys())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load passkeys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function saveRename(id: string, name: string) {
    await renamePasskey(id, name)
    setRenaming(null)
    await load()
  }

  async function confirmDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      return
    }
    await deletePasskey(id)
    setDeleteConfirm(null)
    await load()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-neutral-500">Use passkeys to sign in without email.</p>
        <button className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600" onClick={() => setAddOpen(true)} type="button">Add passkey</button>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      {loading ? <p className="text-sm text-neutral-500">Loading passkeys...</p> : null}
      {!loading && items.length === 0 ? <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500">No passkeys yet. Add one to enable sign-in.</p> : null}
      <div className="space-y-3">
        {items.map((item) => (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm" key={item.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {renaming === item.id ? <RenameForm initialName={item.name} onCancel={() => setRenaming(null)} onSave={(name) => saveRename(item.id, name)} /> : <p className="font-semibold text-neutral-950">{item.name}</p>}
                <p className="mt-1 text-xs text-neutral-500">Created {formatDate(item.createdAt)}{item.lastUsedAt ? ` · Last used ${formatDate(item.lastUsedAt)}` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50" onClick={() => setRenaming(item.id)} type="button">Rename</button>
                <button className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => void confirmDelete(item.id)} type="button">{deleteConfirm === item.id ? 'Confirm delete' : 'Delete'}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {addOpen || blocking ? <AddPasskeyModal blocking={blocking} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void load() }} /> : null}
    </section>
  )
}

function AddPasskeyModal({ blocking, onClose, onAdded }: { blocking?: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const passkeyAvailable = typeof window !== 'undefined' && 'PublicKeyCredential' in window

  async function add() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await runPasskeyRegistration(name.trim())
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add passkey')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal dismissOnBackdrop={!blocking} label="Add passkey" onClose={blocking ? () => undefined : onClose}>
      <h2 className="text-lg font-bold text-neutral-950">Name this passkey</h2>
      <p className="mt-2 text-sm text-neutral-500">{blocking ? 'Passkeys are the only sign-in method. Add one now so this account can sign in again.' : 'Use a device name like “Personal iPhone”. Face ID will start after you continue.'}</p>
      {blocking && !passkeyAvailable ? <FormError className="mt-3 font-semibold">This browser does not support passkeys. Open this page on a device with platform passkey support.</FormError> : null}
      <input autoFocus className="mt-5 w-full rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" onChange={(event) => setName(event.target.value)} placeholder="iPhone" value={name} />
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        {!blocking ? <button className="flex-1 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700" onClick={onClose} type="button">Cancel</button> : null}
        <button className="flex-1 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={saving || !name.trim() || (blocking && !passkeyAvailable)} onClick={() => void add()} type="button">{saving ? 'Waiting...' : 'Next'}</button>
      </div>
    </Modal>
  )
}

function RenameForm({ initialName, onCancel, onSave }: { initialName: string; onCancel: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  return (
    <form className="flex max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSave(name.trim()).finally(() => setSaving(false)) }}>
      <input className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm" onChange={(event) => setName(event.target.value)} value={name} />
      <button className="rounded-xl bg-neutral-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={saving || !name.trim()} type="submit">Save</button>
      <button className="rounded-xl px-3 py-2 text-sm text-neutral-500" onClick={onCancel} type="button">Cancel</button>
    </form>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
