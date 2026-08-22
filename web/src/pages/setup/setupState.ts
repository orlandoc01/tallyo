export const OBFUSCATED_SECRET = '********'

export type SetupState = {
  passwordEnabled: boolean
  oauthEnabled: boolean
  masterPassword: string
  passkeyEnabled: boolean
  googleEnabled: boolean
  emailEnabled: boolean
  oauthIssuerUrl: string
  frontendRedirectUris: string
  googleClientId: string
  googleClientSecret: string
  smtpHost: string
  smtpPort: string
  smtpFrom: string
  smtpUsername: string
  smtpPassword: string
  webauthnRpId: string
  webauthnRpName: string
  webauthnRpOrigins: string
  registeredEmail: string
}

const origin = typeof window === 'undefined' ? '' : window.location.origin

export const initialSetupState: SetupState = {
  passwordEnabled: false,
  oauthEnabled: false,
  masterPassword: '',
  passkeyEnabled: false,
  googleEnabled: false,
  emailEnabled: true,
  oauthIssuerUrl: origin,
  frontendRedirectUris: origin ? `${origin}/auth/callback` : '',
  googleClientId: '',
  googleClientSecret: '',
  smtpHost: 'smtp.gmail.com',
  smtpPort: '587',
  smtpFrom: 'Tallyo',
  smtpUsername: '',
  smtpPassword: '',
  webauthnRpId: typeof window === 'undefined' ? '' : window.location.hostname,
  webauthnRpName: 'Tallyo',
  webauthnRpOrigins: origin,
  registeredEmail: '',
}
