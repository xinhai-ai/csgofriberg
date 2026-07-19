# Docker production deployment

The production image is PostgreSQL-only and published by GitHub Actions to:

```text
ghcr.io/xinhai-ai/csgofriberg
```

The runtime image is based on distroless Node.js. It contains only production
Node dependencies, compiled server JavaScript, compiled frontend assets and the
player seed files emitted into `server/dist`. It does not contain pnpm, Rust,
TypeScript, Vite, source files, tests, build tools or the SQLite driver.

The included Compose stack runs the application, PostgreSQL and Redis with
settings suitable for a small 1 GB server. Reverse proxy and TLS remain outside
this stack. The application port binds to `127.0.0.1` by default.

## 1. Install Docker

Install Docker Engine with the Compose plugin. Verify:

```bash
docker version
docker compose version
```

## 2. Create the deployment directory

Only three repository files are required on the server:

```text
compose.yaml
deploy/.env.example
deploy/README.md
```

For example:

```bash
sudo mkdir -p /opt/csgofriberg
sudo cp compose.yaml /opt/csgofriberg/compose.yaml
sudo cp deploy/.env.example /opt/csgofriberg/.env
cd /opt/csgofriberg
sudo chmod 600 .env
sudo editor .env
```

Generate independent secrets:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -hex 24
```

Use the first two values for `JWT_SECRET` and `GUEST_ID_SALT`. Use the
hexadecimal value for `POSTGRES_PASSWORD`. Compose constructs `DB_URL` from the
PostgreSQL variables, so the password is configured only once.

Set `CORS_ORIGINS` to the exact public origin, such as
`https://game.example.com`, without a trailing slash.

## 3. Start

For a public GHCR package:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f app
```

If the package is private, authenticate first using a GitHub token with
`read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u GITHUB_USERNAME --password-stdin
```

The application calls `initDb()` before it starts listening. This creates or
updates tables and indexes and imports the bundled player seed only when the
player table is empty. A migration failure causes the application container to
exit instead of serving against a partial schema.

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

## 4. Reverse proxy

Keep `TRUST_PROXY=true` when one trusted reverse proxy sits directly in front
of the application. Do not expose the Node port publicly in that mode. Nginx
must forward HTTP and Socket.IO WebSocket traffic and set:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

HTTP and Socket.IO rate limits both use the nearest trusted proxy hop.

## 5. Create or reset the administrator

Run the compiled administration command inside a one-off application
container. This uses the same image and network as production:

```bash
docker compose run --rm \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='replace-with-at-least-12-characters' \
  app server/dist/db/createAdmin.js
```

The password is visible to the local process environment while this command is
running. On a shared server, use a temporary root-only environment file and
pass it with `docker compose run --env-file`.

## 6. Update and rollback

Update to the current tag in `.env`:

```bash
docker compose pull app
docker compose up -d app
docker image prune -f
```

For deterministic production releases, set `IMAGE` to a published version or
commit tag, for example:

```text
IMAGE=ghcr.io/xinhai-ai/csgofriberg:sha-0123456
```

Rollback by changing `IMAGE` to the previous tag and running:

```bash
docker compose pull app
docker compose up -d app
```

PostgreSQL and Redis data live in named volumes and are not replaced when the
application image changes.

## 7. Backups

PostgreSQL:

```bash
docker compose exec -T postgres \
  pg_dump -U csgofriberg -d csgofriberg -Fc > csgofriberg.dump
```

Redis stores active games, rooms, queues and caches. PostgreSQL is the durable
history store. Redis AOF is enabled in Compose so active state can survive a
container restart.

## GitHub Actions publishing

`.github/workflows/docker.yml` runs tests and the complete production build on
pull requests. Pushes to `main`, version tags such as `v1.2.3`, and manual runs
also build the `linux/amd64` image and publish it to GHCR.

Published tags include:

- `latest` for the default branch
- the branch name
- semantic-version tags for `v*` releases
- `sha-<short commit>` for deterministic deployment

The workflow uses BuildKit cache, generates provenance and attaches an SBOM.
