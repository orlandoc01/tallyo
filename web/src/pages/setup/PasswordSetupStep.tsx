import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { FormError } from '../../components/common/FormControls'
import { OBFUSCATED_SECRET } from './setupState'
import { useSetup } from './useSetup'
import { SetupActions, SetupHeading, SetupTextField, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

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
        eyebrow="Password setup"
        title={<>{masterPasswordStatus === 'ENV_VAR_OVERRIDE' ? <span title="Currently set by ENV VAR, which overrides whatever you set here"><AlertCircle className="h-6 w-6 shrink-0 text-amber-500" /></span> : null}Set the master password</>}
        titleClassName="mt-3 flex items-center gap-2 text-3xl font-black tracking-tight text-neutral-900"
      />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">This password can be used alongside OAuth providers and is sent as the API key for single-password sign-in.</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <SetupTextField label="Master password" onChange={setPassword} type="password" value={password} />
        <SetupTextField label="Confirm master password" onChange={setConfirmPassword} type="password" value={confirmPassword} />
      </div>

      {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}

      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate('/setup/security')} type="button">Back</button>
        <button className={primaryButtonClass} onClick={continueSetup} type="button">Continue</button>
      </SetupActions>
    </div>
  )
}
