# systemd production deployment

This deployment runs one Node process with PostgreSQL and Redis. Reverse proxy,
TLS and domain routing are intentionally outside the scope of this systemd
setup. The unit runs the compiled database migration before every application
start; if migration fails, the service is not started.

## 1. Install prerequisites

Example for Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y postgresql redis-server build-essential pkg-config libssl-dev
sudo corepack enable
```

Install a current Node.js LTS release before building. `node` must be available
at `/usr/bin/node`; adjust the systemd unit if the path differs. Rust is
optional when the tracked precompiled PoW WASM matches the current source. To
rebuild that module, install Rust and run:

```bash
rustup target add wasm32-unknown-unknown
```

## 2. Create PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER csgofriberg WITH PASSWORD 'replace-password';
CREATE DATABASE csgofriberg OWNER csgofriberg;
\connect csgofriberg
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
```

The application migration also requests `pg_trgm`, but installing it as the
database administrator avoids requiring extension privileges for the runtime
account.

## 3. Build and install

```bash
sudo useradd --system --home /var/lib/csgofriberg --create-home --shell /usr/sbin/nologin csgofriberg
sudo mkdir -p /opt/csgofriberg /etc/csgofriberg
sudo chown -R "$USER":csgofriberg /opt/csgofriberg

git clone <repository-url> /opt/csgofriberg
cd /opt/csgofriberg
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Do not run `pnpm install --prod` before building: TypeScript and Vite are
build-time requirements. The compiled service itself starts with plain Node and
does not require `tsx`. Keep the repository owned by the deployment user; the
restricted `csgofriberg` service account only needs read access to the built
files. When Rust is unavailable, `pnpm build` uses the tracked precompiled
`client/public/pow/csgofriberg_pow.wasm`; the build only falls back when its
recorded source hash matches the current Rust source. This prevents an outdated
PoW module from being silently reused after source changes.

## 4. Configure environment

```bash
sudo cp deploy/csgofriberg.env.example /etc/csgofriberg/csgofriberg.env
sudo chmod 600 /etc/csgofriberg/csgofriberg.env
sudo editor /etc/csgofriberg/csgofriberg.env
```

Generate independent secrets:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Set `CORS_ORIGINS` to the exact public origin, for example
`https://game.example.com`, without a trailing slash. Keep `TRUST_PROXY=true`
when the service is reached through your existing trusted ingress; set it to
`false` only when clients connect directly to the Node process. The Node port
must not be publicly reachable when this is enabled. Your ingress must replace
or append the standard real-IP headers, for example in Nginx:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

HTTP and Socket.IO rate limits both use the nearest trusted proxy hop from
these headers. The current setting is intentionally limited to one trusted
proxy layer.

## 5. Enable systemd

```bash
sudo cp deploy/systemd/csgofriberg.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now redis-server postgresql csgofriberg
```

Configure your existing ingress separately to forward HTTP and Socket.IO
WebSocket traffic to the application port defined by `PORT`.

## 6. Create the administrator

Run this once after the database migration has completed. Put the bootstrap
credentials in a temporary root-only environment file so shell parsing and
history do not expose them:

```bash
sudo install -m 600 /dev/null /etc/csgofriberg/admin-bootstrap.env
sudo editor /etc/csgofriberg/admin-bootstrap.env
# Add ADMIN_USERNAME=... and ADMIN_PASSWORD=... to that file.

sudo systemd-run --wait --pipe --collect \
  --property=User=csgofriberg \
  --property=Group=csgofriberg \
  --property=WorkingDirectory=/opt/csgofriberg \
  --property=EnvironmentFile=/etc/csgofriberg/csgofriberg.env \
  --property=EnvironmentFile=/etc/csgofriberg/admin-bootstrap.env \
  /usr/bin/node /opt/csgofriberg/server/dist/db/createAdmin.js

sudo rm /etc/csgofriberg/admin-bootstrap.env
```

## Updating

```bash
cd /opt/csgofriberg
sudo systemctl stop csgofriberg
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm build
sudo systemctl start csgofriberg
sudo systemctl status csgofriberg --no-pager
```

On `systemctl start`, `ExecStartPre` runs
`server/dist/db/migrate.js`. This creates or updates tables and indexes, imports
the bundled player seed only when the player table is empty, and exits before
Node starts listening. Logs are available through:

```bash
journalctl -u csgofriberg -f
curl http://127.0.0.1:3000/api/health
```
