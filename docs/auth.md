# Authentication

Tallyo supports a master password, Google Sign-In, email codes with magic links,
and passkeys. The OAuth-backed methods share Tallyo's built-in OAuth 2.1
authorization server and role system. More than one method can be enabled at a
time.

Read [reverse-proxy.md](reverse-proxy.md) before configuring OAuth or passkeys. General hardening guidance is in [security.md](security.md).

## Choose A Method

| Method | Best fit | Important tradeoff |
|---|---|---|
| Master password | Simple, single-admin or automation access | One shared credential grants every scope and is stored in each signed-in browser |
| Google | Households already relying on Google accounts | Requires Google Console Project configuration, and an exact callback configuration |
| Email code or magic link | Users with reliable SMTP access | Mail delivery is part of the login path and requires configuring an email account for invites/deliveries |
| Passkey | Phishing-resistant sign-in from supported devices, no email | Requires HTTPS, users need to share invite codes for initial access to register Passkeys|

For a private deployment not publicly exposed to the internet, Master Password alone is probably fine

For a household deployment publicly exposed to the internet, Master Password is not recommended and Email or Passkey sign in is simple and secure enough for most public use cases. Test before removing Master Password authentication

## Master Password

The master password is also Tallyo's only API-key fallback. It grants all read
and write scopes, including user and configuration management. Requests use:

```http
X-API-Key: <master-password>
```

The web app stores the entered value in browser `localStorage` under the
Tallyo origin and sends it as `X-API-Key` when no OAuth access token is in
memory. Signing out or the idle logout clears it, but closing the tab alone
does not. Any script running on the same origin can read `localStorage`, so do
not host unrelated applications on the Tallyo origin and do not reuse this
credential anywhere else.

Set the master password during setup, in **Settings -> Security**, within the
**Authorization** tile, or by setting the  `MASTER_PASSWORD` env var directly. The environment value overrides
the database value.

If the database-configured master password is lost, setting a new
`MASTER_PASSWORD` in the service environment and restarting provides a
recovery path. Protect that environment and its deployment configuration like
any other secret.

## Canonical OAuth URLs

OAuth must use one canonical external HTTPS origin. For this example:

```text
Origin:                 https://tallyo.example.com
OAuth issuer URL:       https://tallyo.example.com
Frontend redirect URI:  https://tallyo.example.com/auth/callback
Google redirect URI:    https://tallyo.example.com/auth/google/callback
WebAuthn RP ID:         tallyo.example.com
WebAuthn RP origin:     https://tallyo.example.com
```

The frontend always sends `<origin>/auth/callback`. That exact value must be added to
**Frontend redirect URIs** in settings. Matching is string-exact: scheme, hostname, port,
path, and trailing slash must agree.

Tallyo requires OAuth authorization code flow with PKCE `S256`; plain PKCE is
rejected. The default access-token lifetime is 15 minutes and the default
refresh-token lifetime is 168 hours (7 days). These fields accept Go duration
syntax such as `15m` and `168h` and can be modified in **Settings -> Security**. Authorization codes and login sessions expire
after 10 minutes. Refresh tokens rotate, and a previously rotated token is no
longer accepted.

Access tokens are signed JWTs and are checked without a database lookup.
Removing a user revokes that user's refresh tokens, but an already issued
access token can continue working until its short expiry. Browser sign-out only
clears that browser's local credentials; it does not provide server-side token
revocation, so a copied refresh token may remain usable until it expires or the
user is removed. Changing the issuer also makes existing tokens fail issuer
validation, so expect users to sign in again after an origin or issuer
migration.

## Google Sign-In

1. Create an OAuth client in Google Cloud Console with application type **Web
   application**.
2. Add exactly `<origin>/auth/google/callback` as an authorized redirect URI.
   For the example origin, use
   `https://tallyo.example.com/auth/google/callback` with no trailing slash.
3. Enter the client ID and client secret in **Settings -> Security ->
   Google Sign-In**, then enable the provider.
4. Ensure **OAuth issuer URL** and **Frontend redirect URIs** use the same
   external origin.

Google authentication does not create users automatically. The lowercase
email returned by Google must already exist in Tallyo. The setup wizard creates
the initial admin user; afterward, an admin adds or invites users from
**Settings -> Access**. An unknown Google account receives a forbidden
response.

If Google reports `redirect_uri_mismatch`, compare the URI shown by Google with
the configured value character by character. Do not use the frontend callback
for Google; Google calls `/auth/google/callback`, while Tallyo later returns the
browser to `/auth/callback`.

## Email Codes And Magic Links

Enable **Email Sign-In** and configure:

| Field | Purpose |
|---|---|
| SMTP host | Mail server hostname; leaving it empty selects development log delivery |
| SMTP port | SMTP port; the setup wizard initially suggests `587` |
| SMTP from | Envelope sender and `From` address |
| SMTP username | SMTP authentication username |
| SMTP password | SMTP authentication password |

Each sign-in email contains both a six-digit code and a one-time magic link.
Both expire after 10 minutes. A user must wait 60 seconds before requesting a
replacement, and an OTP is limited to five verification attempts. A consumed
magic link cannot be reused.

Email sign-in also requires the address to exist in Tallyo. Requests for an
unknown address return a generic success response to avoid disclosing the user
list, but no email is sent.


## Passkeys

Passkeys use WebAuthn and require a secure browser context. Use HTTPS in
production. Browsers generally permit plain HTTP only for localhost testing.

- **RP name** *(optional)* is the display name shown by authenticators and defaults to
  `Tallyo`.
- **RP ID** *(optional)* is a hostname only, such as `tallyo.example.com`. It has no scheme,
  path, or port.
- **RP origins** *(optional)* are exact origins, such as
  `https://tallyo.example.com`. Include a non-default port when the public URL
  has one. Do not include a path.

When RP ID or RP origins are left empty, Tallyo derives them from the OAuth
issuer. The issuer hostname becomes the RP ID and `scheme://host[:port]`
becomes the origin. Explicit values are easier to audit behind a reverse
proxy.

Registration normally requires an authenticated user. During first-run setup,
the wizard creates the initial admin and permits that admin to register a
passkey before setup is completed. Passkey-only setup cannot finish without an
admin passkey. Existing users can add, rename, and delete their passkeys in
**Settings -> Access**. An admin can also generate a short-lived invite link for
a listed user. After using it to sign in, the user should open **Settings ->
Access** to register a passkey.

Changing the RP ID makes existing passkeys unusable for the new RP. Before a
hostname migration, enable and test another authentication method or retain a
working master password.

## Users, Invites, And Roles

OAuth-backed sign-in is allowlisted by the `users` table. Admins manage it from
**Settings -> Access**. Adding a user assigns a role and sends a 24-hour magic
link through the configured email sender. Admins can also generate a one-time
15-minute sign-in link for a listed user. Treat invite URLs as credentials
until they expire or are used.

Roles are `admin`, `writer`, `readonly`, `spend_tracker`,
`cashflow_tracker`, `net_worth_tracker`, and `portfolio_tracker`. Roles map to
OAuth scopes; the backend enforces those scopes even if a client displays more
controls. The master password and `DISABLE_ALL_AUTH` bypass role restrictions
and receive every scope.

## Safe Configuration Changes

Use this order when adding or replacing a sign-in method:

1. Keep the current working admin method enabled.
2. Add the required user record and configure the new provider.
3. If this is the first OAuth provider, configure the issuer and exact frontend
   callback in the Authorization card and save.
4. Test a fresh private browser session, including token refresh or passkey
   registration as applicable.
5. Add a second recovery credential.
6. Disable the old method.

Every section applies live. Saving the Authorization section, including master
password, issuer, frontend redirects, token durations, development CORS, or
disable-all-auth, rebuilds the OAuth provider in place; enabling the first OAuth
provider on a master-password-only instance mounts the OAuth routes the same
way. Nothing exits or restarts. Access tokens issued under a previous issuer
stop validating, so users sign in again after an issuer change.

Tallyo rejects a completed configuration with no authentication method. It
also rejects a transition to passkey-only authentication unless an admin
passkey already exists. Environment values for `MASTER_PASSWORD` and
`DISABLE_ALL_AUTH` always override the database settings.

## `DISABLE_ALL_AUTH`

`DISABLE_ALL_AUTH=true` is only for local development. It grants every request
all scopes without identifying a user. Tallyo rejects it when the configured
OAuth issuer is not an HTTP localhost or loopback URL, but an empty issuer is
also possible during initial setup. Therefore, bind or firewall an unfinished
instance to a trusted local network and never use this setting as a deployment
shortcut.

First-run setup temporarily has authentication-free bootstrap behavior when
setup is incomplete and no master password exists. Do not expose a fresh
instance publicly before completing the wizard.
