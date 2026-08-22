# CSV Transaction Import

Tallyo has a CSV transaction import endpoint and a desktop UI for it.

> [!CAUTION]
> Import has no preview and is not atomic. Valid rows can be committed while invalid rows are skipped. A database failure later in the file can also leave earlier rows committed even though the request returns an error.

## UI And Permissions

The UI path is:

1. Sign in with a role that has `read:transactions` and `write:transactions`.
2. Open **Transactions**.
3. In the desktop toolbar, select **Import / Export**, then **Import**.
4. Choose or drop a `.csv` file and select **Import**.

The transaction toolbar is hidden on smaller/mobile viewports. There is currently no equivalent import control in the mobile layout, so use a desktop-width browser window or call the REST endpoint directly.

The UI rejects files larger than 10 MiB (`10 * 1024 * 1024` bytes). It also requires a filename ending in `.csv`. These are browser-side checks; do not treat the REST endpoint as a way to bypass safe import sizing.

Import requires the `write:transactions` scope. Export only requires `read:transactions`. The `admin` and `writer` roles can import; `readonly` can export but cannot import. Tracker-only roles do not have raw transaction access.

## REST Endpoint

Send a multipart request to:

```text
POST /transactions/import
Content-Type: multipart/form-data
form field: file
```

Authenticate with an OAuth bearer access token or the configured master password API key:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer <access-token>" \
  -F "file=@<csv-file>;type=text/csv" \
  "https://<tallyo-host>/transactions/import"
```

For a master-password-only installation, use `-H "X-API-Key: <master-password>"` instead of the bearer header. Avoid putting either credential in the URL.

A parsed import returns JSON even when some rows were skipped:

```json
{
  "processed": 2,
  "skipped": 1,
  "errors": [
    { "row": 3, "message": "invalid amount \"12 USD\"" }
  ]
}
```

`row` counts data records starting at 1; it does not count the header record.

## Headers

The first CSV record must be a header. Header names are case-insensitive and surrounding spaces are ignored.

Required headers:

| Header | Requirement |
|---|---|
| `account_id` | Required. Prefer the account's GraphQL/global ID. Legacy external/provider account identifiers are also accepted. |
| `datetime` | Required. Transaction date or timestamp. |
| `amount` | Required. Plain decimal number with at most two fractional digits. |

At least one of these headers must also exist:

| Header | Requirement |
|---|---|
| `merchant_name` | Optional only when `original_name` is present. For each row, one of the two name values must be non-empty. |
| `original_name` | Optional only when `merchant_name` is present. For each row, one of the two name values must be non-empty. |

Optional headers understood by import:

| Header | Behavior |
|---|---|
| `posted_datetime` | Defaults to `datetime` when blank or absent. |
| `external_id` | Stable transaction identifier for re-import updates. Blank or absent values get generated IDs. |
| `source` | Transaction source namespace for matching `external_id`. Blank or absent values default to `manual`. Exported CSV files include this column. |
| `category` | Matches an existing category name case-insensitively. See [Categorization And Rules](#categorization-and-rules). |
| `notes` | Stored as transaction notes. |
| `is_recurring` | True only when the trimmed value equals `true`, ignoring case. |
| `is_hidden` | True only when the trimmed value equals `true`, ignoring case. |

Unknown columns are ignored. In particular, export-only fields such as `account_name`, `owner`, `is_reviewed`, and `pending` are not imported.

## Re-Import Handling

If `external_id` is present, import stores that value on new transactions. Re-importing a row with the same `source` and `external_id` updates that transaction's imported fields instead of creating a duplicate. Blank or absent `source` values match the `manual` namespace.

Provider sync can later overwrite provider-owned fields such as amount, dates, names, and pending status for Plaid or SimpleFIN transactions.

If `external_id` is blank or absent, Tallyo generates one. Those rows cannot be matched on a later retry unless the generated IDs are exported and supplied on the next import.

## File And Value Conventions

Dates and timestamps:

- `YYYY-MM-DD` is accepted and stored as noon UTC on that date.
- A full timestamp must be RFC 3339, for example `2026-07-09T14:30:00Z` or `2026-07-09T10:30:00-04:00`.
- Other local date/time forms, such as `07/09/2026` or `2026-07-09 14:30:00`, are rejected.
- A blank `posted_datetime` uses the parsed `datetime` value.

Amounts:

- Use a plain number with `.` as the decimal separator, such as `12.34` or `-5.00`.
- Use at most two digits after the decimal separator; sub-cent values are rejected.
- Positive means money spent.
- Negative means a refund, credit, or money flowing in.
- Do not include currency symbols, currency codes, or thousands separators.

Booleans:

- `true`, in any letter case, means true.
- Blank, `false`, `1`, `yes`, and every other value mean false; they do not produce a validation error.

## Account Resolution

Import first accepts `account_id` values that are GraphQL/global account IDs, the same opaque IDs returned by the GraphQL API and written by CSV export. For older CSV files and integrations, import also falls back to the account `external_id` stored for provider-backed accounts.

If a row cannot be resolved, it is skipped with:

```text
account_id "..." not found
```

Other valid rows continue to import. A numeric local database ID is not accepted unless it is encoded as the account's GraphQL/global ID.

## Categorization And Rules

For each row whose account resolves:

1. If `category` matches an existing category name, that category is assigned and the transaction is marked reviewed.
2. If `category` is blank or does not match, Tallyo evaluates transaction rules using the row's merchant/original name, amount, and resolved account.
3. A matching rule can assign a category or tags and can change recurring/hidden behavior.
4. If no category is assigned, the transaction uses the built-in `uncategorized` category and is not marked reviewed.

Category matching ignores letter case but otherwise uses the category name, not a category group name or ID. An unknown category is not reported as an import error; it falls through to rules and then `uncategorized`.

An explicit valid category takes precedence and bypasses rule application for that row. A rule that sets `is_hidden` can hide a row, and a rule's recurring setting overrides the CSV recurring value. CSV `is_hidden=true` remains hidden even when a matching rule does not request hiding.

Imported rows do not carry a Plaid personal-finance category, so Plaid category mapping does not apply. The import path also does not stage uncategorized rows for Ollama categorization.

## Minimal Sample

This sample shows the format only. `ACCOUNT_GRAPHQL_ID` must be replaced by an account ID from the GraphQL API or a CSV export.

```csv
account_id,datetime,amount,merchant_name
ACCOUNT_GRAPHQL_ID,2026-07-09,12.34,Coffee Shop
```

## Errors And Recovery

Common HTTP results:

| Result | Meaning |
|---|---|
| `200` JSON | Parsing completed. Inspect both `processed` and `skipped`; a 200 can include row errors. |
| `400 missing file field` | The multipart form did not contain a field named `file`. |
| `400 csv parse error: ...` | Missing headers, malformed CSV syntax, inconsistent field count, or another file-level parse failure. No rows are inserted when parsing fails before database processing. |
| `401 unauthorized` | Missing or invalid bearer token/master password. |
| `403 forbidden` | Authenticated, but missing `write:transactions`. |
| `500 import failed` | Database/account/category/rule processing failed. Check server logs. Rows processed before the failure may already exist. |

Row-level validation errors skip only that row. They include missing values, invalid dates/timestamps, invalid amounts, and unknown account identifiers. After any partial success or `500` response, inspect Transactions before retrying. Retrying a file without stable `source` and `external_id` values can duplicate rows that were already committed.

See [Troubleshooting](troubleshooting.md#csv-import-and-export) for operational checks and [FAQ](faq.md) for related behavior.
