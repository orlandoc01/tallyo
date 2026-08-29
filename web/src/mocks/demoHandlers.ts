import { graphql, http, HttpResponse, type GraphQLResponseResolver } from 'msw'

const base = import.meta.env.BASE_URL
const api = graphql.link(`${base}query`)
const unavailable = (feature: string) => `${feature} needs a real Tallyo server and is not available in this demo.`
const graphqlUnavailable = (feature: string): GraphQLResponseResolver => () => HttpResponse.json({ errors: [{ message: unavailable(feature) }] })
const restUnavailable = (feature: string) => () => new HttpResponse(unavailable(feature), { status: 501 })

// Overrides for flows that would otherwise hit Plaid/WebAuthn or bounce off GitHub Pages' 404.
export const demoHandlers = [
  api.mutation('CreateLinkToken', graphqlUnavailable('Plaid Link')),
  api.mutation('CreateUpdateLinkToken', graphqlUnavailable('Plaid Link')),
  http.post(`${base}auth/webauthn/register/begin`, restUnavailable('Passkey registration')),
  http.post(`${base}auth/email/send`, restUnavailable('Email sign-in')),
]
