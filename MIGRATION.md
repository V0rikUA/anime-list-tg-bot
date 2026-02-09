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
