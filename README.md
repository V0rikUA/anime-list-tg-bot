<<<<<<< HEAD
# anime-list-tg-bot
=======
# Anime Telegram Bot + Telegram Mini App

Bot features:
- search anime from multiple APIs (Jikan + AniList)
- track watched / planned / favorite anime
- personal watched counter and friends watched counter
- recommendations between friends
- friend system via invite token or invite link
- dashboard API for frontend/mini app
- Telegram Mini App dashboard (`/app`)

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` values:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (for invite links)
- `DB_CLIENT` (`pg` for docker compose, `sqlite3` for local sqlite)
- `DATABASE_URL` (required for `pg`)
- `WEB_APP_URL` (public URL for mini app, usually `https://your-domain/app`)
- `STARTUP_MAX_RETRIES`, `STARTUP_RETRY_DELAY_MS` (DB readiness gate before start)
- `WEBAPP_AUTH_MAX_AGE_SEC` (max age for Telegram `initData`, default 86400)

Also set Mini App URL in BotFather:
- `/setmenubutton` -> choose your bot -> set `WEB_APP_URL`

## Run (Docker + Postgres)

```bash
docker compose up --build -d
```

Backend: `http://localhost:4000`

## Run (without Docker)

Use sqlite fallback:

```bash
DB_CLIENT=sqlite3 npm start
```

## Migrations

Application runs migrations on startup automatically.

Manual run:

```bash
npm run migrate
```

Inside docker:

```bash
docker compose exec app npm run migrate
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
- `GET /app` (Mini App UI)
- `POST /api/telegram/validate-init-data` (validate Telegram WebApp initData)
- `POST /api/webapp/dashboard` (secure dashboard by initData; used by Mini App)

Example:

```bash
curl http://localhost:4000/api/dashboard/123456789
```

Telegram initData validation example:

```bash
curl -X POST http://localhost:4000/api/telegram/validate-init-data \
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

1. Start backend: `docker compose up -d`
2. Create tunnel: `cloudflared tunnel --url http://localhost:4000`
3. Copy HTTPS URL from cloudflared output, then set in `.env`:
   - `API_BASE_URL=https://<your-url>`
   - `WEB_APP_URL=https://<your-url>/app`
4. In BotFather set `/setmenubutton` to `WEB_APP_URL`.
5. Restart app: `docker compose up -d --build`
6. In bot run `/app` and open Mini App button.

## Telegram Webhook (Cloudflare Tunnel)

1. Start backend (docker or local).
2. Run tunnel (backend listens on 4000):

```bash
cloudflared tunnel --url http://localhost:4000
```

3. Take HTTPS URL from output and set:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (optional but recommended)

4. Apply webhook:

```bash
npm run webhook:delete
npm run webhook:set
npm run webhook:info
```

Backend requirements:
- Telegram will POST JSON updates to `TELEGRAM_WEBHOOK_URL`.
- Backend responds `200` immediately and processes updates asynchronously.
- If `TELEGRAM_WEBHOOK_SECRET` is set, backend enforces `X-Telegram-Bot-Api-Secret-Token`.
>>>>>>> b5578fc (init)
