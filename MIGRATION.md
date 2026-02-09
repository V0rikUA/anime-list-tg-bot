# Migration Notes: Gateway + Microservices (MVP)

This repo keeps the legacy deployment path intact and adds an optional microservices path.

## Goals (MVP)
- Keep current bot + Mini App working.
- Keep `watch-api` as a separate service.
- Add an HTTP-only API Gateway and two internal services:
  - `catalog-service` (best-match search + ranking)
  - `list-service` (lists CRUD)

## Local (microservices)

This branch runs the microservices layout by default via `docker-compose.yml`:

```bash
docker compose --profile frontend up --build
```

Dev (hot reload):

```bash
docker compose -f docker-compose.dev.yml --profile frontend up --build
```

Endpoints:
- Gateway: `http://localhost:8080/healthz`
- Webapp service: internal (health: `http://webapp:8080/healthz`)
- Watch service: internal (via gateway: `http://localhost:8080/api/watch/v1/health`)

## Production (Debian VM + Docker + Caddy)

For subdomain-based routing on a VM, use the included `docker-compose.proxy.yml` + `Caddyfile`.

Example:
```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml --profile frontend up -d --build
```

Expected DNS:
- `mini.indexforge.site` -> VM IP (Mini App UI + `/api/*` + `/webhook`)
- `api.indexforge.site` -> VM IP (gateway only)

Env highlights:
- `WEB_APP_URL=https://mini.indexforge.site/`
- `TELEGRAM_WEBHOOK_URL=https://api.indexforge.site/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (recommended)

## Switching Mini App to gateway
In micro mode, `frontend` receives `BACKEND_URL=http://gateway:8080` (compose override).
No code changes in Next.js routes are required.

## Internal token
`catalog-service` and `list-service` can be protected by `INTERNAL_SERVICE_TOKEN`.
- Gateway injects `X-Internal-Service-Token` when proxying to these services.
- Gateway strips any inbound `X-Internal-Service-Token` from client requests.

For local dev, leaving `INTERNAL_SERVICE_TOKEN` empty will allow calls (misconfig-safe).

## TODO (post-MVP)
- Move more reads to dedicated services (e.g. dashboard/friends/recommendations).
- Add a dedicated migration job/cron for DB migrations (currently `webapp-service` runs migrations on startup).
