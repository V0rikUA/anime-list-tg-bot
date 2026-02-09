# Anime Telegram Bot + Telegram Mini App

[English](README.md) | [Русский](README.ru.md) | [Українська](README.uk.md)

Можливості бота:
- пошук аніме через кілька API (Jikan + AniList)
- трекінг списків: переглянуте / план / обране
- особистий лічильник переглядів та сумарний лічильник друзів
- рекомендації між друзями
- система друзів через інвайт-токен або посилання
- Dashboard API для фронтенда/mini app
- Telegram Mini App дашборд (`/`)

## Налаштування

```bash
cd bot-service && npm install
cd ../webapp-service && npm install
cd ../frontend && npm install
cp .env.example .env
```

Заповни значення в `.env`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (для інвайт-посилань)
- `WATCH_API_URL` (URL сервісу `watch-api`, наприклад `http://watch-api:8000`)
- `WATCH_SOURCES_ALLOWLIST` (опційно, список джерел `anicli_api` через кому)
- `DB_CLIENT` (`pg` для docker compose, `sqlite3` для локальної sqlite)
- `DATABASE_URL` (обов'язково для `pg`)
- `WEB_APP_URL` (публічний URL mini app, зазвичай `https://your-domain/`)
- `STARTUP_MAX_RETRIES`, `STARTUP_RETRY_DELAY_MS` (очікування готовності DB під час старту)
- `WEBAPP_AUTH_MAX_AGE_SEC` (max age для Telegram `initData`, за замовчуванням 86400)

Також задай URL Mini App у BotFather:
- `/setmenubutton` -> обери бота -> встанови `WEB_APP_URL`

## Запуск (Docker + Postgres)

```bash
docker compose --profile frontend up --build
```

Gateway: `http://localhost:8080`

## Прод (Debian VM + Docker + Caddy, сабдомени)

У репозиторії є конфіг Caddy для сабдоменів:
- `mini.indexforge.site` -> UI Mini App (`/`) та same-origin `/api/*` + `/webhook` на gateway
- `api.indexforge.site` -> gateway (усі шляхи)

Кроки:
1. Налаштуй DNS A записи `mini.indexforge.site` і `api.indexforge.site` на IP віртуалки.
2. Відкрий порти `80` і `443` у firewall.
3. У `.env` задай:
   - `WEB_APP_URL=https://mini.indexforge.site/`
   - `TELEGRAM_WEBHOOK_URL=https://api.indexforge.site/webhook`
   - `TELEGRAM_WEBHOOK_SECRET=<random string>` (рекомендовано)
4. Запусти стек (назовні публікує порти лише Caddy):

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml --profile frontend up -d --build
```

TLS сертифікати Caddy отримає автоматично та збереже в Docker volume.

## Мікросервіси (MVP) + Gateway

У репозиторії використовується мікросервісна схема (тільки HTTP, без брокера):
- `gateway-service` (єдина точка входу для API)
- `webapp-service` (API для Mini App: `/api/webapp/*` + dashboard)
- `bot-service` (Telegram bot + webhook receiver)
- `catalog-service` (пошук + ранжування best-match + кеш)
- `list-service` (CRUD списків)
- `watch-api` (існуючий FastAPI сервіс)

Health gateway: `http://localhost:8080/healthz`

## Запуск (без Docker)

Використай sqlite (запусти сервіси окремо):

```bash
cd webapp-service && DB_CLIENT=sqlite3 PORT=8080 npm start
```

## Міграції

Застосунок запускає міграції автоматично під час старту.

Ручний запуск:

```bash
cd webapp-service && npm run migrate
```

Усередині docker:

```bash
docker compose exec webapp npm run migrate
```

## Команди Telegram

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
- `/feed` (рекомендації від друзів)
- `/invite`
- `/join <token>`
- `/friends`
- `/stats <uid>`
- `/dashboard`
- `/app`
- `/lang` (вибір мови)

## Dashboard API (для фронтенда)

- `GET /api/dashboard/:telegramUserId`
- `GET /api/users/:telegramUserId/watch-stats/:uid`
- `GET /api/users/:telegramUserId/friends`
- `GET /health`
- `GET /` (Mini App UI)
- `POST /api/telegram/validate-init-data` (валідувати Telegram WebApp initData)
- `POST /api/webapp/dashboard` (безпечний дашборд через initData; використовується Mini App)
- `POST /api/webapp/watch/search` (посилання: пошук)
- `POST /api/webapp/watch/episodes` (посилання: епізоди)
- `POST /api/webapp/watch/sources` (посилання: джерела для епізоду)
- `POST /api/webapp/watch/videos` (посилання: відео/якість)

### Ранжування пошуку watch-api

Endpoint `watch-api` `GET /v1/search` тепер сортує верхній список `items` за релевантністю ("найкращий збіг") до запиту.

Опційні query-параметри:
- `rank=false` щоб вимкнути ранжування і залишити порядок джерела
- `rank_q=<title>` щоб ранжувати за "канонічною" назвою (при цьому пошук по джерелу все одно виконується за `q`)

Важливо: епізоди/серії не пересортовуються (епізоди отримуються окремо через `GET /v1/episodes`).

Приклад:

```bash
curl http://localhost:8080/api/dashboard/123456789
```

Приклад валідації initData:

```bash
curl -X POST http://localhost:8080/api/telegram/validate-init-data \
  -H 'Content-Type: application/json' \
  -d '{"initData":"<raw tg initData string>"}'
```

## Модель даних

Таблиці `knex`:
- `users`
- `anime`
- `user_anime_lists` (`watched`, `planned`, `favorite`, `watch_count`)
- `user_recommendations`
- `friendships`
- `friend_invites`

## Швидкий тест через Cloudflared

1. Запусти сервіси: `docker compose --profile frontend up -d --build`
2. Запусти тунелі (frontend + gateway):

```bash
./scripts/cloudflared-tunnels.sh
```

3. Візьми публічний URL Frontend з виводу і встанови `WEB_APP_URL` у `.env`, потім онови BotFather `/setmenubutton`.

## Telegram Webhook (Cloudflare Tunnel)

1. Запусти сервіси (docker або локально).
2. Запусти тунель на gateway (gateway слухає 8080):

```bash
cloudflared tunnel --url http://localhost:8080
```

3. Візьми HTTPS URL і задай:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (опційно, але рекомендується)

4. Застосуй webhook через Telegram API:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \\
  -d "url=${TELEGRAM_WEBHOOK_URL}" \\
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Вимоги до bot-service:
- Telegram буде POST-ити JSON апдейти на `TELEGRAM_WEBHOOK_URL`.
- Gateway відповідає `200` одразу, а `bot-service` обробляє апдейти асинхронно.
- Якщо `TELEGRAM_WEBHOOK_SECRET` задано, `bot-service` перевіряє `X-Telegram-Bot-Api-Secret-Token`.
