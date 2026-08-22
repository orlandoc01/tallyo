# Security Policy

Tallyo handles personal finance data and integrates with Plaid, OAuth, email authentication, passkeys, and local SQLite storage. Please report security issues privately so users have time to update before details are public.

## Supported Versions

Tallyo is currently pre-1.0 software. Security fixes are best-effort and will generally target the latest released version and the main branch.

Older releases may not receive patches unless the maintainer explicitly says otherwise in a release note.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately. Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not available, email the maintainer using the address listed on the GitHub profile.

Do not open a public issue for vulnerabilities, secrets, logs containing financial data, or attack details. Include the affected version or commit, a concise reproduction, and any relevant logs with secrets and personal financial data redacted.

Please include:

- A summary of the issue and likely impact.
- Affected version, commit, or deployment mode.
- Reproduction steps or a proof of concept.
- Relevant logs with all secrets and personal financial data removed.
- Whether you believe the issue is actively exploitable.

Please do not include access tokens, Plaid credentials, account numbers, private transaction data, private keys, OAuth secrets, real email OTPs, or live database backups.

## Response Expectations

This is a solo-maintained project. The maintainer will make a best-effort attempt to acknowledge valid reports within 7 days, but responses may be slower depending on availability.

Expected handling for valid reports:

- Confirm the issue and affected versions.
- Prepare a fix or mitigation.
- Publish a release or patch guidance when practical.
- Credit the reporter if requested and appropriate.

## Scope

In scope:

- Authentication and authorization bypasses.
- Exposure of Plaid access tokens, OAuth secrets, signing keys, or database contents.
- Cross-site scripting, CSRF, token leakage, or session fixation in the web app.
- Vulnerabilities in backup, import/export, GraphQL, MCP, or public REST endpoints.
- Container or deployment defaults that expose sensitive data.

Out of scope unless there is a concrete exploit path:

- Reports that require already having full administrator access to the host.
- Missing security headers without demonstrated impact.
- Denial-of-service issues requiring unrealistic local access or resources.
- Dependency CVEs that do not affect the built application or reachable code paths.

## Deployment Expectations

Tallyo is a household-scale self-hosted finance app. Run it behind your own reverse proxy, VPN, or other access control, keep it updated, and avoid exposing it directly to the public internet without authentication.

## Safe Harbor

Good-faith research is welcome when it avoids privacy violations, data destruction, service disruption, and public disclosure before a fix is available.

Do not test against deployments you do not own or operate without explicit permission. Do not attempt to access, modify, or exfiltrate other people's data.

## No Bug Bounty

There is currently no paid bug bounty program. Reports are appreciated, but compensation is not offered.
