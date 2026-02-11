# Migration Notes: Microservices + Gateway (Current)

This repo is now fully migrated to a microservices layout (HTTP-only, no broker). The previous monolithic backend has been removed/split.

## Goals (MVP)
- Keep current bot + Mini App working.
- Keep `watch-api` as a separate service.
- Run everything behind a single API Gateway entrypoint.

## Services (current)
- `gateway-service`: public API entrypoint, request id, timeouts, GET retries, routing:
  - `/api/*` -> `webapp-service`
  - `/webhook` -> `bot-service`
  - `/api/v1/catalog/*` -> `catalog-service`
  - `/api/v1/list/*` -> `list-service`
  - `/api/watch/*` -> `watch-api` (prefix rewrite)
- `webapp-service`: Mini App API (`/api/webapp/*`, dashboard endpoints), runs DB migrations on startup
- `bot-service`: Telegram bot + webhook receiver (proxied by gateway)
- `catalog-service`: title search + deterministic best-match ranking + in-memory cache
- `list-service`: lists CRUD (DB-backed), protected by internal token (optional in dev)
- `watch-api`: FastAPI service for watch links (`/v1/health`, `/v1/search`, `/v1/episodes`, ...)

## Canonical UID + dedupe (current)
- `catalog-service` now deduplicates `jikan` + `shikimori` by MAL ID and emits canonical `uid=mal:<id>`.
- Search response includes:
  - `legacyUids` (e.g. `["jikan:185","shikimori:185"]`)
  - `sourceRefs` (source-level refs/urls)
  - optional `synopsisRu`, `synopsisUk`
- Localization policy:
  - RU title/synopsis from Shikimori
  - EN title/synopsis from Jikan
  - UK title/synopsis translated RU->UK with EN->UK fallback

Backward compatibility:
- `webapp-service`, `bot-service`, and `list-service` resolve legacy source UIDs through `anime_uid_aliases`.
- Existing actions with old `jikan:*` / `shikimori:*` UIDs continue to work.

## Local (microservices)

Local run (with ports exposed to host):

```bash
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml up --build
```

Dev (hot reload):

```bash
docker compose --env-file .env.local -f docker-compose.dev.yml --profile frontend up --build
```

Endpoints:
- Gateway: `http://localhost:8080/healthz`
- Webapp service: internal (health: `http://webapp:8080/healthz`)
- Bot service: internal (health: `http://bot:8080/healthz`)
- Watch service: via gateway: `http://localhost:8080/api/watch/v1/health`

## Production (Debian VM + Docker + Caddy)

For subdomain-based routing on a VM, use the included `docker-compose.proxy.yml` + `Caddyfile`.

Example:
```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Expected DNS:
- `mini.indexforge.site` -> VM IP (Mini App UI + `/api/*` + `/webhook`)
- `api.indexforge.site` -> VM IP (gateway only)

Env highlights:
- `WEB_APP_URL=https://mini.indexforge.site/`
- `TELEGRAM_WEBHOOK_URL=https://api.indexforge.site/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (recommended)

## Production (Debian VM + Docker + Traefik)

If you prefer Traefik for subdomains + automatic TLS, use `docker-compose.traefik.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Required `.env`:
- `MINI_HOST=mini.indexforge.site`
- `API_HOST=api.indexforge.site`
- `TRAEFIK_ACME_EMAIL=you@example.com`
- `BOT_SEARCH_MODE=catalog` (recommended)

## Mini App API base
In docker compose, `frontend` is configured with `BACKEND_URL=http://gateway:8080`.
No code changes in Next.js routes are required; the gateway preserves existing `/api/*` paths.

## Internal token
`catalog-service` and `list-service` can be protected by `INTERNAL_SERVICE_TOKEN`.
- Gateway injects `X-Internal-Service-Token` when proxying to these services.
- Gateway strips any inbound `X-Internal-Service-Token` from client requests.

For local dev, leaving `INTERNAL_SERVICE_TOKEN` empty will allow calls (misconfig-safe).

## TODO (post-MVP)
- Move remaining DB writes/reads out of `bot-service` into `list-service` (and other domain services).
- Add a dedicated migration job/cron for DB migrations (currently `webapp-service` runs migrations on startup).
