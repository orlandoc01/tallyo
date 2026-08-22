# Plaid Setup

Tallyo uses Plaid Link to connect bank and brokerage logins, then polls Plaid for transactions, recurring transactions, account balances, and investment holdings. Liability accounts can contribute their account balances, but Tallyo does not fetch Plaid's detailed Liabilities product data. Plaid is optional; manual accounts, CSV workflows, crypto wallets, and SimpleFIN do not require Plaid.

Read [Installing Tallyo](install.md), [Configuration](configuration.md), and [Security and Deployment Notes](security.md) before storing live financial credentials.

## Create a Plaid developer account

1. Create and verify a developer account in the [Plaid Dashboard](https://dashboard.plaid.com/).
2. Accept Plaid's terms and complete any account or use-case information requested by the Dashboard.
3. For US or Canadian bank-data Link access, Plaid requires newer accounts to select a use-case description under Link customization before using Production Link. Follow the current prompt in the Dashboard. The account should be approved in [Free Trial mode](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan) shortly after provisionin.
4. Open [Developers > Keys](https://dashboard.plaid.com/developers/keys).
5. Copy the team client ID and the secret for the environment you intend to use. The client ID is shared across environments; Sandbox and Production have different secrets.

Plaid's Dashboard, approval process, product access, plans, limits, and pricing can change independently of Tallyo. Confirm the current terms in the Dashboard and Plaid's [environment documentation](https://plaid.com/docs/api/#api-host) before relying on an account for production use.

## Production or Sandbox

Plaid currently documents two active environments:

| Environment | Data | Use in Tallyo |
|---|---|---|
| Sandbox | Simulated data only | Test account linking and sync behavior without real bank credentials. |
| Production | Real financial data | Connect actual institutions after Plaid grants the required access. |

Items and access tokens cannot move between environments. Store separate Tallyo credentials for Sandbox and Production, and do not change the environment of a credential already used by linked Items.

The Tallyo UI currently offers only Sandbox and Production. Plaid's former Development environment has been decommissioned and is not a supported UI choice.

Plaid currently documents a Trial plan for eligible US and Canadian developers with up to 10 Production Items and a defined product set. It also documents full paid Production access for broader usage. Eligibility, approval, institution coverage, limits, included products, and price are Plaid decisions, so use the current [Trial plan documentation](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan) rather than assuming continued availability or a particular cost.

Even though Plaid supports more countries, Tallyo currently requests only `US` in Link tokens and institution lookups. Canadian and other non-US institution support is therefore not currently requested by Tallyo.

## Store credentials in Tallyo

1. Sign in as an administrator.
2. Open Settings > Connections and select Plaid.
3. Choose Store Credentials.
4. Enter the Plaid client ID, the matching environment secret, Sandbox or Production, and an optional label.
5. Save the credential.

The secret is write-only in the UI and API. Tallyo stores it in SQLite and never returns it. The client ID is immutable after creation; editing a credential rotates its secret or changes its environment.

Tallyo supports multiple Plaid credentials. Labels make them distinguishable, and every new Item is assigned to the credential selected during Link. This can separate Sandbox from Production or separate household members' Plaid developer accounts. A credential cannot be deleted while linked Items still reference it.

For a Plaid secret rotation, Plaid's documented process keeps the old secret active until it is deleted in the Dashboard. Update the matching Tallyo credential with the new secret, verify linking and sync, and only then remove the old secret in Plaid. See Plaid's [key rotation documentation](https://plaid.com/docs/account/security/#rotating-keys).

## Link an Item

Plaid calls one login at one institution an Item. One Item can contain several accounts, such as checking and savings under the same login.

1. Create the household owner who should own the connection. The setup wizard requires at least one owner, and authorized users can also create one from the Link form.
2. Open Accounts > Link Connection.
3. Choose Bank / brokerage, then Plaid.
4. Select a Plaid credential if more than one exists. Tallyo automatically selects it when there is exactly one.
5. Select the owner and choose Continue to Plaid.
6. Complete Plaid Link. Tallyo exchanges the short-lived public token on the server, stores the resulting access token, creates the Item and accounts, and starts initial synchronization.

Tallyo asks Plaid for Transactions and requests additional consent for Investments and Liabilities. Actual product and institution access still depends on the Plaid account and environment.

Do not link the same institution login repeatedly to work around a sync problem. Duplicate Items have separate access tokens and may count separately under Plaid's plan. Use the repair flow instead.

## Safe Sandbox test login

Plaid's official [Sandbox test credentials](https://plaid.com/docs/sandbox/test-credentials/) include:

```text
Username: user_good
Password: pass_good
Two-factor code when requested: 1234
```

Use these only with a Tallyo credential set to Sandbox. They are public test values, not real bank credentials. Plaid notes that special test credentials may be ignored by Sandbox OAuth institutions; use a non-OAuth Sandbox institution when testing specialized flows.

For transaction-focused sample data, Plaid also documents `user_transactions_dynamic` with any password. Consult the Sandbox documentation for current behavior and more specialized simulations.

## Sync schedules

New Plaid Items use these five-field cron schedules:

| Data | Default schedule | Meaning |
|---|---|---|
| Transactions | `0 6,18 * * *` | Twice daily at 06:00 and 18:00 UTC. |
| Recurring transactions | `0 12 * * 0` | Weekly on Sunday at 12:00 UTC. |
| Balances, liabilities, and holdings | `30 16 * * 1-5` | Weekdays at 16:30 America/New_York. |

Background workers check for due work hourly. From an Item's Sync settings, transaction and recurring schedules can be changed together. They must be valid cron expressions with occurrences at least one hour apart. Balance scheduling is shared by the provider and is not currently editable in the Plaid Item UI.

`SYNC_OFF=true` prevents all background sync loops from starting. The database-managed transaction and wealth tracking switches separately pause their corresponding pollers.

Tallyo does not configure a Plaid webhook URL and has no Plaid webhook endpoint. Synchronization is schedule-driven, so new data is not expected to arrive immediately after Plaid makes it available.

## Repair a connection

When Plaid reports that credentials, consent, or multi-factor authentication need attention, Tallyo marks the Item as Update required.

1. Open the connection or the Accounts review queue.
2. Choose Update login.
3. Complete Plaid Link update mode.
4. Tallyo runs a transaction sync and refreshes the Item's health and enabled product flags.

For a general Sync error, check the selected credential's environment and secret, the Plaid Dashboard activity log and service status, outbound network access, and the next scheduled run. Reconnect an inactive Tallyo connection before expecting scheduled work. Do not switch an existing Item between Sandbox and Production; create a credential and Item in the intended environment.

## Secrets and backups

The SQLite database contains Plaid client secrets and long-lived Item access tokens. Treat it and every backup as a credential store.

- Enable database or volume encryption and restrict database and backup access.
- Keep the database encryption key outside the database volume and its backups.
- Never send a Plaid secret, access token, database, or plaintext backup in logs or support messages.
- Enable strong authentication on both Tallyo and the Plaid Dashboard.
- Rotate a Plaid secret in the Dashboard and Tallyo if it may have been exposed.
- Remember that Tallyo's `--backup-plain-data` output is plaintext even when the source database is encrypted.
