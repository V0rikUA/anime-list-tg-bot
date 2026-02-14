# Architecture

## Overview

Anime List Telegram Bot is a microservices-based system for tracking anime, searching from multiple APIs (Jikan + Shikimori/AniList), managing watch lists, and providing a Telegram Mini App dashboard. It supports three languages (EN, RU, UK) and deploys via Docker Compose.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Bot framework | Telegraf 4.16 (Node.js 22) |
| HTTP servers | Fastify 5.7 (Node), FastAPI (Python) |
| Frontend | Next.js 14, React 18, Redux Toolkit |
| Database | PostgreSQL 16 (prod), SQLite (dev) |
| ORM | Knex 3.1 |
| Deployment | Docker Compose, Traefik |

## Directory Structure

```
├── bot-service/        # Telegram bot — commands, callbacks, sessions
├── webapp-service/     # Mini App backend API — auth, dashboard, DB layer
├── catalog-service/    # Anime search — multi-source merge & dedup
├── list-service/       # CRUD for user anime lists, friends, recommendations
├── gateway-service/    # HTTP API gateway — routing, timeouts, retries
├── watch-api/          # Python FastAPI — anime watch source discovery
├── frontend/           # Next.js Mini App UI — dashboard, title pages
├── docker/             # Docker Compose overlay files
└── scripts/            # Helper scripts (cloudflare tunnels)
```

## Key Files

| File | Lines | Purpose |
|------|------:|---------|
| `bot-service/src/index.js` | 1,588 | Main bot logic: command handlers, session state, callbacks |
| `webapp-service/src/db.js` | 1,292 | Database layer: queries, anime normalization, UID resolution |
| `list-service/src/repository.js` | 1,188 | CRUD repository: lists, watches, recommendations, friends |
| `frontend/app/title/[uid]/page.jsx` | 814 | Title detail page with watch source integration |
| `frontend/app/page.jsx` | 728 | Main dashboard page |
| `webapp-service/src/index.js` | 688 | Webapp API: endpoints, Telegram auth, dashboard aggregation |
| `watch-api/app/main.py` | 415 | FastAPI: watch source search, episodes, video streams |
| `catalog-service/src/merge.js` | 256 | Result merging, deduplication, canonical UID mapping |
| `gateway-service/src/index.js` | 152 | API gateway: routing, request IDs, token injection |
| `bot-service/src/i18n.js` | 394 | Internationalization: 3-language support, detection |

## Service Architecture

```
Telegram API ←→ bot-service ←→ catalog-service ←→ Jikan/Shikimori APIs
                    ↕                                    ↕
               list-service ←→ PostgreSQL        (in-memory LRU cache)
                    ↕
              webapp-service ←→ PostgreSQL
                    ↕
           gateway-service (public entrypoint :8080)
                    ↕
              frontend (Next.js :3000) ←→ watch-api ←→ anime source APIs
```

### Service Responsibilities

- **gateway-service**: Single public entrypoint. Routes requests, adds request IDs, injects internal auth tokens, enforces 30s timeouts, retries GETs (max 2).
- **bot-service**: Telegram command/callback handlers (`/search`, `/watch`, `/watched`). In-memory session state. Integrates with catalog + list services.
- **webapp-service**: Mini App API. Validates Telegram initData signatures. Dashboard aggregation. Runs DB migrations on startup.
- **catalog-service**: Searches Jikan + Shikimori, merges/deduplicates results using canonical `mal:<id>` UIDs. LRU cache (500 entries, 10min TTL).
- **list-service**: RESTful CRUD for user anime lists, friend invites, recommendations, watch progress tracking. Own DB migrations.
- **watch-api** (Python): Wraps anicli-api for anime source discovery, episode listing, video stream URLs. In-memory TTL cache.
- **frontend**: Next.js Mini App UI with dashboard, title pages, search, recommendations, multi-language support.

## Module Dependencies (Runtime)

```
bot-service     → catalog-service, list-service, watch-api, Telegram API
webapp-service  → catalog-service, list-service, watch-api, Jikan, Shikimori, PostgreSQL
catalog-service → Jikan API, Shikimori API (no DB)
list-service    → PostgreSQL (no external APIs)
watch-api       → anicli-api extractors (no DB)
frontend        → gateway-service (all /api/* calls)
```

## Database

PostgreSQL with Knex migrations. Key tables:
- `users`, `anime`, `user_anime_lists`, `user_watch_progress`
- `user_recommendations`, `friendships`, `friend_invites`
- `anime_uid_aliases` (legacy UID → canonical `mal:<id>` mapping)

Migrations: 9 in webapp-service, 7 in list-service (Knex `.cjs` format).

## Stability Markers

### Critical — Do NOT modify without careful review
- `webapp-service/src/db.js` — Core database layer, all queries depend on it
- `list-service/src/repository.js` — Data integrity for user lists
- `catalog-service/src/merge.js` — UID deduplication logic, affects all search results
- `gateway-service/src/proxy.js` — Request routing, security token handling
- All `migrations/` files — Never edit existing migrations, only add new ones

### Legacy — Handle with care
- `bot-service/src/services/animeSources.js` — Duplicated in webapp-service; used when `BOT_SEARCH_MODE=local`
- `webapp-service/src/services/animeSources.js` — Same duplication; catalog-service is the preferred path

### Safe to refactor
- `frontend/app/page.jsx` — Dashboard UI, no backend coupling
- `frontend/app/title/[uid]/page.jsx` — Title page UI
- `frontend/lib/store.js` — Redux store, self-contained
- `bot-service/src/utils/formatters.js` — Message formatting helpers
- `bot-service/src/i18n.js` — Translation strings

## Common Tasks

| Task | Where to look |
|------|--------------|
| Add bot command | `bot-service/src/index.js` — add handler in command registration section |
| Add API endpoint | `webapp-service/src/index.js` or `list-service/src/index.js` |
| Change DB schema | Add new migration in `list-service/migrations/` or `webapp-service/migrations/` |
| Update UI | `frontend/app/` — pages in `app/`, API routes in `app/api/` |
| Add anime source | `watch-api/app/main.py` — register extractor |
| Change search logic | `catalog-service/src/merge.js` and `catalog-service/src/ranking.js` |
| Add translation | `bot-service/src/i18n.js`, `frontend/lib/i18n/` (en.js, ru.js, uk.js) |
| Modify gateway routing | `gateway-service/src/proxy.js` |
| Change env config | `.env.example`, then each service's `config.js` |
| Add Docker service | `docker-compose.yml` + create `<service>/Dockerfile` |

## Configuration

Main config: `.env.example` (118 lines). Key variables:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL` — Bot setup
- `INTERNAL_SERVICE_TOKEN` — Inter-service auth
- `DB_CLIENT`, `DATABASE_URL` — Database
- `WATCH_SOURCES_ALLOWLIST` — Enabled anime extractors
- `BOT_SEARCH_MODE` — `catalog` (recommended) or `local`

## Running

```bash
# Docker (production)
docker compose --env-file .env up --build

# Docker (local dev with ports exposed)
docker compose --env-file .env.local -f docker-compose.yml -f docker/docker-compose.local.yml up --build

# Docker (hot reload)
docker compose --env-file .env.local -f docker/docker-compose.dev.yml --profile frontend up --build

# Tests (per service)
cd <service> && npm test          # Node services
cd watch-api && python -m pytest  # Python service
```
