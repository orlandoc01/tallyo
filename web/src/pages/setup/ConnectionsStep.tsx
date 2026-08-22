import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { useMutation } from 'urql'
import { CREATE_PLAID_CREDENTIAL_MUTATION, CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { CreatePlaidCredentialInput, CreateSimpleFinAccessTokenInput, CreateSimpleFinAccessTokenPayload, PlaidCredential, PlaidEnvironment } from '../../types/graphql'
import { FormError, TextAreaField } from '../../components/common/FormControls'
import { CenteredSpinner } from '../../components/common/LoadingSpinner'
import { OwnerSelect } from '../../components/institutions/OwnerSelect'
import { useLinkOwners } from '../../components/institutions/useLinkOwners'
import { SetupActions, SetupHeading, SetupTextField, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

type ProviderTab = 'plaid' | 'simplefin'

const TABS: { value: ProviderTab; label: string }[] = [
  { value: 'plaid', label: 'Plaid' },
  { value: 'simplefin', label: 'SimpleFIN' },
]

export function ConnectionsStep() {
  const navigate = useNavigate()
  const { owners, fetching: ownersFetching } = useOwners()
  const [activeTab, setActiveTab] = useState<ProviderTab>('plaid')

  useEffect(() => {
    if (!ownersFetching && owners.length === 0) navigate('/setup/owners', { replace: true })
  }, [navigate, owners.length, ownersFetching])

  return (
    <div>
      <SetupHeading eyebrow="Data providers" title="Connect your data provider" />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">Configure Plaid or SimpleFIN to start syncing transactions. You can skip this for now and add credentials later in Settings.</p>

      <div className="mt-8 inline-flex rounded-2xl bg-brand-100 p-1" role="tablist" aria-label="Connection providers">
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.value}
            className={clsx(
              'rounded-xl px-4 py-2 text-sm font-bold transition',
              activeTab === tab.value ? 'bg-white text-neutral-900 ring-2 ring-brand-600 shadow-sm' : 'text-brand-800 hover:bg-brand-50',
            )}
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {activeTab === 'plaid' ? <PlaidForm /> : <SimpleFinForm />}
      </div>

      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate(-1)} type="button">Back</button>
        <button className={secondaryButtonClass} onClick={() => navigate('/setup/complete')} type="button">Skip for now</button>
        <button className={primaryButtonClass} onClick={() => navigate('/setup/complete')} type="button">Continue</button>
      </SetupActions>
    </div>
  )
}

function PlaidForm() {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState('')
  const [environment, setEnvironment] = useState<PlaidEnvironment>('SANDBOX')
  const [saved, setSaved] = useState(false)
  const [result, createCredential] = useMutation<{ createPlaidCredential: { credential: PlaidCredential } }, { input: CreatePlaidCredentialInput }>(CREATE_PLAID_CREDENTIAL_MUTATION)

  async function save() {
    const response = await createCredential({ input: { clientId: clientId.trim(), secret, environment, label: label.trim() || null } })
    if (!response.error) setSaved(true)
  }

  return (
    <div>
      <a className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:text-brand-800" href="https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan" rel="noreferrer" target="_blank">
        Plaid Free Trial Signup
        <ExternalLink className="h-4 w-4" />
      </a>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SetupTextField label="Client ID" value={clientId} onChange={setClientId} />
        <SetupTextField label="Secret" type="password" value={secret} onChange={setSecret} />
        <SetupTextField label="Label" placeholder="Primary" value={label} onChange={setLabel} />
        <div>
          <span className="text-sm font-bold text-neutral-900">Environment</span>
          <div className="mt-1 grid grid-cols-2 gap-2 rounded-2xl bg-brand-100 p-1">
            {(['SANDBOX', 'PRODUCTION'] as PlaidEnvironment[]).map((env) => (
              <button
                className={`rounded-xl px-3 py-3 text-sm font-bold transition ${environment === env ? 'bg-white text-neutral-900 ring-2 ring-brand-600 shadow-sm' : 'text-brand-800 hover:bg-brand-50'}`}
                key={env}
                onClick={() => setEnvironment(env)}
                type="button"
              >
                {env.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {saved ? <p className="mt-5 rounded-2xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">Plaid credentials saved.</p> : null}
      {result.error ? <FormError className="mt-5 font-semibold">{result.error.message}</FormError> : null}

      <div className="mt-6">
        <button
          className={primaryButtonClass}
          disabled={result.fetching || !clientId.trim() || !secret}
          onClick={() => void save()}
          type="button"
        >
          {result.fetching ? 'Saving...' : 'Save credentials'}
        </button>
      </div>
    </div>
  )
}

function SimpleFinForm() {
  const { owners, ownersFetching, selectedOwner, setSelectedOwner, handleOwnerCreated } = useLinkOwners()
  const [setupToken, setSetupToken] = useState('')
  const [label, setLabel] = useState('')
  const [saved, setSaved] = useState<{ count: number } | null>(null)
  const [result, createAccessToken] = useMutation<
    { createSimpleFinAccessToken: CreateSimpleFinAccessTokenPayload },
    { input: CreateSimpleFinAccessTokenInput }
  >(CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION)

  async function save() {
    if (!setupToken.trim() || !selectedOwner) return
    const response = await createAccessToken({ input: { setupToken: setupToken.trim(), ownerId: selectedOwner, label: label.trim() || null } })
    const payload = response.data?.createSimpleFinAccessToken
    if (!response.error && payload) {
      setSaved({ count: payload.connections.length })
      setSetupToken('')
      setLabel('')
    }
  }

  const canSave = setupToken.trim() && selectedOwner && !result.fetching

  if (result.fetching) {
    return (
      <CenteredSpinner />
    )
  }

  if (saved) {
    return <p className="mt-5 rounded-2xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">SimpleFIN token saved with {saved.count} connection{saved.count === 1 ? '' : 's'}.</p>
  }

  return (
    <div>
      <a className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:text-brand-800" href="https://bridge.simplefin.org/simplefin/create" rel="noreferrer" target="_blank">
        Open SimpleFIN Bridge
        <ExternalLink className="h-4 w-4" />
      </a>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <TextAreaField className="lg:col-span-2" controlClassName="font-mono" label="Setup Token" labelClassName="font-bold text-neutral-900" minHeight="min-h-24" onChange={setSetupToken} placeholder="Paste the base64 setup token from SimpleFIN Bridge" value={setupToken} />
        <SetupTextField label="Label" placeholder="SimpleFIN Bridge" value={label} onChange={setLabel} />
        {!ownersFetching ? (
          <label className="block text-sm font-bold text-neutral-900">
            Owner
            <OwnerSelect
              canCreate
              onChange={setSelectedOwner}
              onOwnerCreated={handleOwnerCreated}
              owners={owners}
              value={selectedOwner}
            />
          </label>
        ) : null}
      </div>

      {result.error ? <FormError className="mt-5 font-semibold">{result.error.message}</FormError> : null}

      <div className="mt-6">
        <button className={primaryButtonClass} disabled={!canSave} onClick={() => void save()} type="button">
          {result.fetching ? 'Saving...' : 'Save token'}
        </button>
      </div>
    </div>
  )
}
