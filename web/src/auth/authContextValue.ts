import { createContext } from 'react'

export type MasterPasswordStatus = 'DISABLED' | 'ENABLED' | 'ENV_VAR_OVERRIDE'

export interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  scopes: string[]
  masterPasswordStatus: MasterPasswordStatus
  emailAuthEnabled: boolean
  googleAuthEnabled: boolean
  webauthnEnabled: boolean
  disableAllAuth: boolean
  disableTransactionTracking: boolean
  disableWealthTracking: boolean
  hideOwners: boolean
  setupComplete: boolean
  login: () => void
  loginWithPasskey: () => Promise<void>
  loginWithMasterPassword: (password: string) => void
  loginWithEmail: () => void
  refreshGeneralConfiguration: () => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
