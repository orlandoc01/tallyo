# Installing Tallyo

Tallyo is distributed as one server binary with the web application embedded. It stores all application state in one SQLite database and listens on one HTTP port.

For configuration and deployment hardening, also read [Configuration](configuration.md) and [Security and Deployment Notes](security.md). Plaid users should continue with [Plaid Setup](plaid-setup.md), SimpleFIN users with [SimpleFIN Setup](simplefin-setup.md), and crypto users with [Crypto Tracking](crypto-tracking.md).

## Docker run

Create a named volume and start the container:

```bash
docker volume create tallyo-data
docker run -d \
  --name tallyo \
  --user "$(id -u):$(id -g)" \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v tallyo-data:/data \
  'ghcr.io/orlandoc01/tallyo:<full-version>'
```

Open `http://127.0.0.1:8080` and complete the setup wizard before making the service reachable from another machine. Add startup settings with `--env-file <environment-file>` or individual `-e` options; see [Configuration](configuration.md).

If you later plan to enable Google Sign-In or passkeys, establish the final HTTPS reverse proxy and update **Settings -> Security** so that final public origin so callback and WebAuthn values are correct.

The image runs as nonroot UID/GID `65532` by default but, by specifing your own `--user` flag, you can ensure you have read or write acces to the `/data` mountpoint. 

## Docker Compose

```yaml
services:
  tallyo:
    image: ghcr.io/orlandoc01/tallyo:latest
    restart: unless-stopped
    user: "1000:1000" # substititue your UID/GID
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - tallyo-data:/data

volumes:
  tallyo-data:
```

Start it with:

```bash
docker compose up -d
```

The repository's root `docker-compose.yml` is not required; the example above is self-contained and uses the public image. You can replace the named volume with a bind mount, e.g. `./tallyo-data:/data`.

If you use a bind mount, pre-create the host path and own it as the same UID/GID as the container's `user:` **before** the first `docker compose up`/`docker run`. If the path doesn't exist yet, Docker creates it as `root` while setting up the mount, before the container's `user:` directive ever takes effect inside it — the nonroot process then can't write to its own root-owned mount and Tallyo fails every startup with a SQLite `permission denied` error. This applies to any file you bind-mount too (such as a `CONFIG_FILE_PATH` YAML file): a missing host file is created as an empty **directory**, not a file.

```bash
mkdir -p ./tallyo-data
# substitute your own UID/GID if not 1000:1000 — must match the container's `user:`
chown 1000:1000 ./tallyo-data
```

If the mount already got auto-created as `root` from a prior failed run, remove it and redo the step above (`sudo rm -rf ./tallyo-data`) rather than trying to `chown` it as your own user — a non-root user can't take ownership of files it doesn't already own.

## Port, storage, and health

- The HTTP port defaults to `8080`. If `PORT` changes the container's listening port, update the container-side port in the published port mapping too.
- `DB_PATH` defaults to `/data/tallyo.db`
- `GET /healthz` returns HTTP `204` after the HTTP server is ready.
- The release image is distroless and has no shell or HTTP command-line client. It does not define an in-container Docker health check; probe `/healthz` from the host, reverse proxy, or monitoring system.

Database migrations and reference-data updates run automatically whenever Tallyo opens the database. There is no separate migration command.

## Bare release binary

Download the archive and `checksums.txt` for the same version from the [release page](https://github.com/orlandoc01/tallyo/releases). Verify the archive's SHA-256 checksum before extracting it. Release archives include the embedded web application and do not require CGO or a separately installed SQLite library.

Supported release artifacts are:

| Operating system | amd64 | arm64 | Archive |
|---|---:|---:|---|
| Linux | Yes | Yes | `tar.gz` |
| macOS | Yes | Yes | `tar.gz` |
| Windows | Yes | No | `zip` |

On Linux or macOS, set a writable database location because the default is intended for the container:

```bash
DB_PATH='<database-path>' PORT=8080 ./tallyo
```

On Windows PowerShell:

```powershell
$env:DB_PATH = '<database-path>'
$env:PORT = '8080'
./tallyo.exe
```

## systemd

Create a dedicated unprivileged service account, place the release binary in `<install-directory>`, and make `<data-directory>` writable by that account. A minimal unit is:

```ini
[Unit]
Description=Tallyo personal finance server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=tallyo
Group=tallyo
WorkingDirectory=<install-directory>
Environment=DB_PATH=<data-directory>/tallyo.db
Environment=PORT=8080
EnvironmentFile=-<environment-file>
ExecStart=<install-directory>/tallyo
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`Restart=on-failure` is important: saving authorization settings makes Tallyo exit with status 1 so that the supervisor starts it with a fully rebuilt authorization service.

After installing the unit, reload systemd, enable the service, and start it using the normal service-management commands for the host.

Replace every angle-bracketed value before installing the unit. In particular, systemd requires an absolute `EnvironmentFile` location when one is used.

## Database encryption key file

For a new database, generate a 32-byte key as 64 hexadecimal characters and point Tallyo at the file:

```bash
umask 077
openssl rand -hex 32 > '<key-file>'
DB_PATH='<database-path>' DB_ENCRYPTION_KEY_FILE='<key-file>' ./tallyo
```

Keep the key outside the database storage and backups. Losing it makes the encrypted database unreadable. Setting a key on an existing plaintext database is not a conversion operation; use the maintenance procedure in [Database encryption and maintenance](configuration.md#database-encryption-and-maintenance).

## Build from source

A source build requires the versions declared by the repository: Go 1.26.6, Node.js 24, and npm 11.

From a clean checkout:

```bash
npm --prefix web ci
npm --prefix web run build
make -C server sync-web
cd server
go build -trimpath -o tallyo ./cmd/tallyo
```

The resulting `server/tallyo` binary includes the built SPA. Set `DB_PATH` when running it outside the release container.

### Why plain `docker build` does not build a checkout

The root `Dockerfile` is release packaging, not a source-build Dockerfile. GoReleaser first builds a binary for each target platform, arranges platform-specific build contexts, and then invokes the root Dockerfile. Its `COPY` expects a prebuilt `tallyo` binary under the target platform directory.

Consequently, a clean source checkout cannot be built directly with plain `docker build .`. Use the published image, build the binary from source as shown above, or run the repository's GoReleaser release process if you specifically need release-format images.

## Upgrades

1. Read the release notes and identify the exact new version.
2. Create a SQLite backup with Tallyo's backup command. Do not copy the live database file directly.
3. Stop the existing process or container.
4. Replace the binary or change the pinned image tag, then start Tallyo.
5. Confirm that `/healthz` returns `204`, sign in, and check connection sync health.
6. Keep the pre-upgrade backup until the new version has been verified.

Migrations run automatically on first startup of the new version. Do not assume that starting an older binary against a migrated database is a safe rollback; restore the matching pre-upgrade backup if a database rollback is required.
