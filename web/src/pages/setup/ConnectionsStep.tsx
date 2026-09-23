import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { useMutation } from 'urql'
import { CREATE_PLAID_CREDENTIAL_MUTATION, CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { CreatePlaidCredentialInput, CreateSimpleFinAccessTokenInput, CreateSimpleFinAccessTokenPayload, PlaidCredential, PlaidEnvironment } from '../../types/graphql'
import { Button } from '../../components/common/Button'
import { CenteredSpinner } from '../../components/common/LoadingSpinner'
import { SegmentedControl } from '../../components/common/SegmentedControl'
import { OwnerSelect } from '../../components/institutions/OwnerSelect'
import { useLinkOwners } from '../../components/institutions/useLinkOwners'
import { withDataProvider } from './setupState'
import { useSetup } from './useSetup'
import { setupControlClass, setupLabelClass } from './setupClasses'
import { SetupActions, SetupFieldGrid, SetupHeading, SetupMessage, SetupTextField } from './SetupLayout'

type ProviderTab = 'plaid' | 'simplefin'

const TABS = [
  { value: 'plaid', label: 'Plaid' },
  { value: 'simplefin', label: 'SimpleFIN' },
] as const

const ENVIRONMENTS = [
  { value: 'SANDBOX', label: 'sandbox' },
  { value: 'PRODUCTION', label: 'production' },
] as const

export function ConnectionsStep() {
  const navigate = useNavigate()
  const { owners, fetching: ownersFetching } = useOwners()
  const [activeTab, setActiveTab] = useState<ProviderTab>('plaid')

  useEffect(() => {
    if (!ownersFetching && owners.length === 0) navigate('/setup/owners', { replace: true })
  }, [navigate, owners.length, ownersFetching])

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SetupHeading subtitle="Configure Plaid or SimpleFIN to start syncing transactions. You can skip this and add credentials later in Settings." title="Data providers" />
        <SegmentedControl ariaLabel="Connection providers" onChange={setActiveTab} options={TABS} semantics="tab" value={activeTab} />
      </div>

      {activeTab === 'plaid' ? <PlaidForm /> : <SimpleFinForm />}

      <SetupActions>
        <Button onClick={() => navigate(-1)} variant="secondary">Back</Button>
        <Button onClick={() => navigate('/setup/complete')} variant="ghost">Skip for now</Button>
        <Button onClick={() => navigate('/setup/complete')}>Continue</Button>
      </SetupActions>
    </div>
  )
}

function ProviderLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent-hover" href={href} rel="noreferrer" target="_blank">
      {label}
      <ExternalLink aria-hidden className="h-3 w-3" />
    </a>
  )
}

function PlaidForm() {
  const setup = useSetup()
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState('')
  const [environment, setEnvironment] = useState<PlaidEnvironment>('SANDBOX')
  const [saved, setSaved] = useState(false)
  const [result, createCredential] = useMutation<{ createPlaidCredential: { credential: PlaidCredential } }, { input: CreatePlaidCredentialInput }>(CREATE_PLAID_CREDENTIAL_MUTATION)

  async function save() {
    const response = await createCredential({ input: { clientId: clientId.trim(), secret, environment, label: label.trim() || null } })
    if (response.error) return
    setSaved(true)
    setup.updateSetup({ dataProviderSummary: withDataProvider(setup.dataProviderSummary, 'Plaid', `Plaid (${environment.toLowerCase()})`) })
  }

  return (
    <div>
      <ProviderLink href="https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan" label="Plaid free trial signup" />

      <SetupFieldGrid className="mt-3">
        <SetupTextField label="Client ID" mono value={clientId} onChange={setClientId} />
        <SetupTextField label="Secret" type="password" value={secret} onChange={setSecret} />
        <SetupTextField label="Label" placeholder="Primary" value={label} onChange={setLabel} />
        <div>
          <span className={clsx('mb-1.5 block', setupLabelClass)}>Environment</span>
          <SegmentedControl ariaLabel="Environment" fullWidth="always" onChange={setEnvironment} options={ENVIRONMENTS} value={environment} />
        </div>
      </SetupFieldGrid>

      {saved ? <SetupMessage tone="positive">Plaid credentials saved.</SetupMessage> : null}
      {result.error ? <SetupMessage tone="negative">{result.error.message}</SetupMessage> : null}

      <div className="mt-4">
        <Button disabled={result.fetching || !clientId.trim() || !secret} onClick={() => void save()}>
          {result.fetching ? 'Saving...' : 'Save credentials'}
        </Button>
      </div>
    </div>
  )
}

function SimpleFinForm() {
  const setup = useSetup()
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
      const count = payload.connections.length
      setSaved({ count })
      setSetupToken('')
      setLabel('')
      setup.updateSetup({ dataProviderSummary: withDataProvider(setup.dataProviderSummary, 'SimpleFIN', `SimpleFIN · ${count} connection${count === 1 ? '' : 's'}`) })
    }
  }

  const canSave = setupToken.trim() && selectedOwner && !result.fetching

  if (result.fetching) return <CenteredSpinner />

  if (saved) return <SetupMessage tone="positive">SimpleFIN token saved with {saved.count} connection{saved.count === 1 ? '' : 's'}.</SetupMessage>

  return (
    <div>
      <ProviderLink href="https://bridge.simplefin.org/simplefin/create" label="Open SimpleFIN Bridge" />

      <label className="mt-3 block">
        <span className={clsx('mb-1.5 block', setupLabelClass)}>Setup token</span>
        <textarea className={clsx(setupControlClass, 'min-h-[88px] resize-y py-2 font-mono text-xs leading-[18px]')} onChange={(event) => setSetupToken(event.target.value)} placeholder="Paste the base64 setup token from SimpleFIN Bridge" value={setupToken} />
      </label>

      <SetupFieldGrid className="mt-3">
        <SetupTextField label="Label" placeholder="SimpleFIN Bridge" value={label} onChange={setLabel} />
        {!ownersFetching ? (
          <label className="block">
            <span className={clsx('block', setupLabelClass)}>Owner</span>
            <OwnerSelect
              canCreate
              onChange={setSelectedOwner}
              onOwnerCreated={handleOwnerCreated}
              owners={owners}
              value={selectedOwner}
            />
          </label>
        ) : null}
      </SetupFieldGrid>

      {result.error ? <SetupMessage tone="negative">{result.error.message}</SetupMessage> : null}

      <div className="mt-4">
        <Button disabled={!canSave} onClick={() => void save()}>
          {result.fetching ? 'Saving...' : 'Save token'}
        </Button>
      </div>
    </div>
  )
}
