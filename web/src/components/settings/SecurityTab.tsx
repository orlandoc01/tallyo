import { KeyRound } from 'lucide-react'
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { deletePasskey, listPasskeys, renamePasskey, runPasskeyRegistration, type PasskeyCredential } from '../../auth/webauthn'
import { AuthContext } from '../../auth/authContextValue'
import { Button } from '../common/Button'
import { Card, FormError, TextField } from '../common/FormControls'
import { Modal } from '../common/Modal'
import { ListCardHeader } from './ListCardHeader'

export function SecurityTab({ headerActions }: { headerActions?: ReactNode }) {
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
    <Card as="section">
      <ListCardHeader
        actions={<><Button onClick={() => setAddOpen(true)} size="sm">+ Add passkey</Button>{headerActions}</>}
        description="Use passkeys to sign in without email."
        title="Passkeys"
      />
      {error ? <div className="border-t border-border p-4"><FormError>{error}</FormError></div> : null}
      {loading ? <p className="border-t border-border px-4 py-3.5 text-[13px] text-text-muted">Loading passkeys...</p> : null}
      {!loading && items.length === 0 ? <p className="border-t border-border px-4 py-3.5 text-[13px] text-text-muted">No passkeys yet. Add one to enable sign-in.</p> : null}
      {items.map((item) => (
        <div className="flex min-h-12 items-center gap-3 border-t border-border px-4 py-2" key={item.id}>
          <KeyRound aria-hidden className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.6} />
          <div className="min-w-0 flex-1">
            {renaming === item.id ? <RenameForm initialName={item.name} onCancel={() => setRenaming(null)} onSave={(name) => saveRename(item.id, name)} /> : <p className="truncate text-sm font-medium text-text-1">{item.name}</p>}
            <p className="text-xs text-text-muted">Created {formatDate(item.createdAt)}{item.lastUsedAt ? ` · Last used ${formatDate(item.lastUsedAt)}` : ''}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => setRenaming(item.id)} size="sm" variant="secondary">Rename</Button>
            <Button onClick={() => void confirmDelete(item.id)} size="sm" variant="danger">{deleteConfirm === item.id ? 'Confirm delete' : 'Delete'}</Button>
          </div>
        </div>
      ))}
      {addOpen || blocking ? <AddPasskeyModal blocking={blocking} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void load() }} /> : null}
    </Card>
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
      <h2 className="text-base font-semibold tracking-[-0.2px] text-text-1">Name this passkey</h2>
      <p className="mt-1 text-[13px] text-text-muted">{blocking ? 'Passkeys are the only sign-in method. Add one now so this account can sign in again.' : 'Use a device name like “Personal iPhone”. Face ID will start after you continue.'}</p>
      {blocking && !passkeyAvailable ? <FormError className="mt-3 font-semibold">This browser does not support passkeys. Open this page on a device with platform passkey support.</FormError> : null}
      <TextField autoFocus className="mt-4" label="Passkey name" hideLabel onChange={setName} placeholder="iPhone" value={name} />
      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        {!blocking ? <Button className="flex-1" onClick={onClose} variant="secondary">Cancel</Button> : null}
        <Button className="flex-1" disabled={saving || !name.trim() || (blocking && !passkeyAvailable)} onClick={() => void add()}>{saving ? 'Waiting...' : 'Next'}</Button>
      </div>
    </Modal>
  )
}

function RenameForm({ initialName, onCancel, onSave }: { initialName: string; onCancel: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  return (
    <form className="flex max-w-sm items-center gap-2" onSubmit={(event) => { event.preventDefault(); setSaving(true); void onSave(name.trim()).finally(() => setSaving(false)) }}>
      <TextField className="min-w-0 flex-1" hideLabel label="Passkey name" onChange={setName} value={name} />
      <Button disabled={saving || !name.trim()} size="sm" type="submit">Save</Button>
      <Button onClick={onCancel} size="sm" variant="ghost">Cancel</Button>
    </form>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
