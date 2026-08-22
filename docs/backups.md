# Backups And Restore

Tallyo uses one SQLite database. That file contains financial history and
application state, including transactions, accounts, balances, holdings,
budgets, rules, users, roles, passkeys, OAuth tokens, the JWT signing key,
provider access tokens and URLs, and configuration secrets.


## What Tallyo Provides

The binary has a one-shot snapshot command:

```bash
tallyo --backup-plain-data
tallyo --backup-plain-data=/path/to/backup.db
```

It opens the configured `DB_PATH`, uses SQLite `VACUUM INTO` to create a
consistent destination database, logs the source and destination, and exits.
It does not start the HTTP server or background sync loops.

The built-in command does **not** schedule backups, encrypt backup files,
upload them, apply retention, or restore them. Those are separate operator
tasks.

### Backup Destination Rules

- With no path, `/data/tallyo.db` becomes `/data/tallyo.plain.db`. In general,
  `<name>.<extension>` becomes `<name>.plain.<extension>` beside the source.
- An explicit existing directory receives the same generated plaintext name.
- An explicit file path is used as written.
- Use the equals sign. `--backup-plain-data=/backup/tallyo.db` passes a path;
  `--backup-plain-data /backup/tallyo.db` enables the flag but does not pass
  that path to this boolean-style option.
- The destination parent directory must already exist.
- The destination file must not already exist. Use a unique timestamp or move
  the previous file first.
- The source cannot be the in-memory database.

### Plaintext Is Deliberate

`--backup-plain-data` always writes a standard plaintext SQLite database, even
when the source uses Tallyo's at-rest encryption. The command must receive the
source database's current `DB_ENCRYPTION_KEY` or
`DB_ENCRYPTION_KEY_FILE`; otherwise it cannot open an encrypted source.

The plaintext output is useful for inspection and portable restores, but it is
not safe to leave in a broadly readable directory. Restrict permissions and
move it immediately into external encryption or an encrypted backup
repository.

## Do Not Copy A Live WAL Database

Tallyo runs SQLite in WAL mode. Copying only `tallyo.db` while Tallyo is running
can omit committed data still represented by `tallyo.db-wal` or produce an
inconsistent set. Copying the database, WAL, and shared-memory files one by one
is not an atomic snapshot either.

Use `--backup-plain-data` for a live logical snapshot, or stop Tallyo cleanly
before making a filesystem-level copy or storage snapshot. Avoid opening the
live database over NFS, SMB, SSHFS, or another filesystem with unreliable
SQLite locking.

## Backup Commands

### Docker Compose

For the Compose service named `tallyo`, write a unique snapshot into its data
volume:

```bash
docker compose exec -T tallyo /tallyo \
  --backup-plain-data=/data/tallyo-$(date -u +%Y%m%dT%H%M%SZ).plain.db
```

`/data` already exists in the image. If you choose a subdirectory or a separate
bind mount, create that parent before running the command. A file left in the
same volume protects against application mistakes, but not volume loss or host
failure. Copy the snapshot to an encrypted, off-host repository after it is
created.

### Bare Binary

Use the same `DB_PATH` and, for an encrypted source, the same key settings as
the running service:

```bash
DB_PATH=/var/lib/tallyo/tallyo.db \
DB_ENCRYPTION_KEY_FILE=/run/secrets/tallyo-db-key \
./tallyo \
  --backup-plain-data=/var/backups/tallyo/tallyo-$(date -u +%Y%m%dT%H%M%SZ).plain.db
```

Omit `DB_ENCRYPTION_KEY_FILE` only when the source is unencrypted. Ensure
`/var/backups/tallyo` exists and is writable by the process user. Run the
command as a user that can read the database and key, but avoid making the
result world-readable.

## Back Up Before Upgrading

Create the pre-upgrade snapshot with the currently deployed Tallyo binary,
then upgrade. The backup command opens the source through Tallyo's normal
database initialization, which runs migrations before `VACUUM INTO`. Running a
newer binary solely to make a "pre-upgrade" backup can therefore migrate the
source before the snapshot exists.

Keep the pre-upgrade binary and its backup until the new release has been
verified. Do not assume a database migrated by a newer release can be opened by
an older binary.

## External Encryption And Retention

External tools are optional and are not bundled with Tallyo. Common patterns
include:

- Send the plaintext snapshot directly into an encrypted backup repository
  such as restic, then remove the local plaintext only after the repository
  reports success.
- Encrypt a snapshot with age, GPG, or host storage encryption before copying
  it off-host.
- Keep at least one copy on another machine or object store and one copy not
  continuously writable by the Tallyo host.
- Use a retention policy appropriate to your transaction history, for example
  daily, weekly, and monthly generations rather than one file repeatedly
  overwritten.
- Keep encryption credentials outside both the Tallyo data volume and the
  backup repository. Test that recovery credentials are usable.


## Restore An Unencrypted Database

There is no built-in restore command. To restore a plaintext backup as an
unencrypted database:

1. Verify and, if necessary, decrypt the backup into a protected staging
   directory.
2. Stop Tallyo cleanly and confirm the process is no longer writing.
3. Move the current `DB_PATH`, its `-wal`, and its `-shm` sidecars out of the
   data directory as one rollback set. Do not mix old sidecars with the
   restored file.
4. Copy the verified plaintext snapshot to `DB_PATH`, set ownership to the
   Tallyo process user, and restrict permissions.
5. Remove `DB_ENCRYPTION_KEY` and `DB_ENCRYPTION_KEY_FILE` from the service
   environment for this unencrypted restore.
6. Start Tallyo with `SYNC_OFF=true`, verify health and data, then restore the
   normal sync setting.

Start with the backup's original Tallyo version when possible, then take
another snapshot before upgrading through newer migrations.

## Restore Into Tallyo Encryption

To restore a plaintext snapshot and make the live database encrypted:

1. Stop Tallyo and preserve the current database and sidecars as described
   above.
2. Place the verified plaintext snapshot at the configured `DB_PATH`.
3. Choose the 64-character hexadecimal Tallyo database key and make it
   available through `DB_ENCRYPTION_KEY_FILE` or `DB_ENCRYPTION_KEY`.
4. Ensure `<DB_PATH>.bak` does not exist. Move an older `.bak` to protected
   storage instead of overwriting it.
5. Run the one-shot encryption command with the target version:

```bash
DB_PATH=/var/lib/tallyo/tallyo.db \
DB_ENCRYPTION_KEY_FILE=/run/secrets/tallyo-db-key \
./tallyo --encrypt-db
```

The command creates the encrypted database at `DB_PATH` and renames the
plaintext original to `<DB_PATH>.bak`. It refuses to run if that `.bak` already
exists. The `.bak` is still plaintext and contains every secret in the
database; after verifying the encrypted database and an independent backup,
remove it securely or archive it under external encryption.

Start Tallyo with the same key setting and `SYNC_OFF=true`, verify the restore,
then re-enable normal operation. Losing both the database key and all plaintext
or externally decryptable backups is unrecoverable.
