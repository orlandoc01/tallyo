import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/common/Button'
import { OBFUSCATED_SECRET } from './setupState'
import { useSetup } from './useSetup'
import { SetupActions, SetupFieldGrid, SetupHeading, SetupMessage, SetupTextField } from './SetupLayout'

export function PasswordSetupStep() {
  const navigate = useNavigate()
  const setup = useSetup()
  const { masterPasswordStatus } = useAuth()
  const initialPassword = setup.masterPassword || (masterPasswordStatus !== 'DISABLED' ? OBFUSCATED_SECRET : '')
  const [password, setPassword] = useState(initialPassword)
  const [confirmPassword, setConfirmPassword] = useState(initialPassword)
  const [error, setError] = useState<string | null>(null)

  function continueSetup() {
    if (!password) {
      setError('Enter a master password.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setup.updateSetup({ masterPassword: password })
    navigate(setup.oauthEnabled ? '/setup/oauth-setup' : '/setup/owners')
  }

  return (
    <div>
      <SetupHeading
        subtitle="Used alongside OAuth providers and sent as the API key for single-password sign-in."
        title={<>{masterPasswordStatus === 'ENV_VAR_OVERRIDE' ? <span title="Currently set by ENV VAR, which overrides whatever you set here"><AlertCircle aria-hidden className="h-3.5 w-3.5 text-warning" /></span> : null}Master password</>}
      />

      <SetupFieldGrid className="mt-4 max-w-[640px]">
        <SetupTextField label="Master password" onChange={setPassword} type="password" value={password} />
        <SetupTextField label="Confirm master password" onChange={setConfirmPassword} type="password" value={confirmPassword} />
      </SetupFieldGrid>

      {error ? <SetupMessage tone="negative">{error}</SetupMessage> : null}

      <SetupActions>
        <Button onClick={() => navigate('/setup/security')} variant="secondary">Back</Button>
        <Button onClick={continueSetup}>Continue</Button>
      </SetupActions>
    </div>
  )
}
