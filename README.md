# Anime Telegram Bot + Telegram Mini App

[English](README.md) | [Русский](README.ru.md) | [Українська](README.uk.md)

Bot features:
- search anime from multiple APIs (Jikan + AniList)
- track watched / planned / favorite anime
- personal watched counter and friends watched counter
- recommendations between friends
- friend system via invite token or invite link
- dashboard API for frontend/mini app
- Telegram Mini App dashboard (`/`)

## Setup

```bash
cd bot-service && npm install
cd ../webapp-service && npm install
cd ../frontend && npm install
cp .env.example .env
```

Fill `.env` values:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (for invite links)
- `WATCH_API_URL` (internal `watch-api` service URL, e.g. `http://watch-api:8000`)
- `WATCH_SOURCES_ALLOWLIST` (optional, comma-separated `anicli_api` sources)
- `DB_CLIENT` (`pg` for docker compose, `sqlite3` for local sqlite)
- `DATABASE_URL` (required for `pg`)
- `WEB_APP_URL` (public URL for mini app, usually `https://your-domain/`)
- `STARTUP_MAX_RETRIES`, `STARTUP_RETRY_DELAY_MS` (DB readiness gate before start)
- `WEBAPP_AUTH_MAX_AGE_SEC` (max age for Telegram `initData`, default 86400)

Also set Mini App URL in BotFather:
- `/setmenubutton` -> choose your bot -> set `WEB_APP_URL`

## Run (Docker + Postgres)

```bash
docker compose --profile frontend up --build
```

Dashboard (Next.js): `http://localhost:3000/`
Gateway: `http://localhost:8080`

For Telegram Mini App you must use an HTTPS URL (domain or tunnel) that points to the Next.js service (port 3000) and set `WEB_APP_URL` to `https://<domain>/`.

## Microservices (MVP) + Gateway

This repo uses an HTTP-only microservices layout (no broker) with:
- `gateway-service` (single API entrypoint)
- `webapp-service` (Mini App API: `/api/webapp/*` + dashboard endpoints)
- `bot-service` (Telegram bot + webhook receiver)
- `catalog-service` (best-match search ranking + cache)
- `list-service` (lists CRUD)
- `watch-api` (existing FastAPI service)

Gateway health: `http://localhost:8080/healthz`

## Dev (Docker + Postgres + Hot Reload)

```bash
docker compose -f docker-compose.dev.yml --profile frontend up --build
```

Dev compose starts services with `npm run dev` and mounts code into containers.

## Run (without Docker)

Use sqlite fallback (run services separately):

```bash
cd webapp-service && DB_CLIENT=sqlite3 PORT=8080 npm start
```

## Migrations

Application runs migrations on startup automatically.

Manual run:

```bash
cd webapp-service && npm run migrate
```

Inside docker:

```bash
docker compose exec webapp npm run migrate
```

## Telegram commands

- `/search <title>`
- `/watch <uid>`
- `/watched`
- `/unwatch <uid>`
- `/plan <uid>`
- `/planned`
- `/unplan <uid>`
- `/favorite <uid>`
- `/favorites`
- `/unfavorite <uid>`
- `/recommend <uid>`
- `/recommendations`
- `/unrecommend <uid>`
- `/feed` (recommendations from friends)
- `/invite`
- `/join <token>`
- `/friends`
- `/stats <uid>`
- `/dashboard`
- `/app`

## Dashboard API (for frontend)

- `GET /api/dashboard/:telegramUserId`
- `GET /api/users/:telegramUserId/watch-stats/:uid`
- `GET /api/users/:telegramUserId/friends`
- `GET /health`
- `GET /` (Mini App UI)
- `POST /api/telegram/validate-init-data` (validate Telegram WebApp initData)
- `POST /api/webapp/dashboard` (secure dashboard by initData; used by Mini App)
- `POST /api/webapp/watch/search` (watch links: search)
- `POST /api/webapp/watch/episodes` (watch links: episodes)
- `POST /api/webapp/watch/sources` (watch links: sources for episode)
- `POST /api/webapp/watch/videos` (watch links: videos/qualities)

### watch-api search ranking

`watch-api` endpoint `GET /v1/search` now sorts top-level `items` by "best match" relevance to the query.

Optional query params:
- `rank=false` to disable ranking and keep source order
- `rank_q=<title>` to use a canonical title for ranking (while still searching with `q`)

Note: episodes/series are not re-sorted (episodes are fetched separately via `GET /v1/episodes`).

Example:

```bash
curl http://localhost:8080/api/dashboard/123456789
```

Telegram initData validation example:

```bash
curl -X POST http://localhost:8080/api/telegram/validate-init-data \
  -H 'Content-Type: application/json' \
  -d '{"initData":"<raw tg initData string>"}'
```

## Data model

`knex` tables:
- `users`
- `anime`
- `user_anime_lists` (`watched`, `planned`, `favorite`, `watch_count`)
- `user_recommendations`
- `friendships`
- `friend_invites`

## Cloudflared quick test

1. Start services: `docker compose --profile frontend up -d --build`
2. Run tunnels (frontend + gateway):

```bash
./scripts/cloudflared-tunnels.sh
```

3. Set `WEB_APP_URL` in `.env` to the public Frontend URL (from the script output) and update BotFather `/setmenubutton`.

## Telegram Webhook (Cloudflare Tunnel)

1. Start services (docker or local).
2. Run a tunnel to gateway (gateway listens on 8080):

```bash
cloudflared tunnel --url http://localhost:8080
```

3. Take HTTPS URL from output and set:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (optional but recommended)

4. Apply webhook via Telegram API:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \\
  -d "url=${TELEGRAM_WEBHOOK_URL}" \\
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Bot requirements:
- Telegram will POST JSON updates to `TELEGRAM_WEBHOOK_URL`.
- Gateway responds `200` immediately and `bot-service` processes updates asynchronously.
- If `TELEGRAM_WEBHOOK_SECRET` is set, `bot-service` enforces `X-Telegram-Bot-Api-Secret-Token`.
