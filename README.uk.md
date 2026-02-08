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
npm install
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
docker compose up --build -d
```

Backend: `http://localhost:4000`

## Запуск (без Docker)

Використай sqlite:

```bash
DB_CLIENT=sqlite3 npm start
```

## Міграції

Застосунок запускає міграції автоматично під час старту.

Ручний запуск:

```bash
npm run migrate
```

Усередині docker:

```bash
docker compose exec backend npm run migrate
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

Приклад:

```bash
curl http://localhost:4000/api/dashboard/123456789
```

Приклад валідації initData:

```bash
curl -X POST http://localhost:4000/api/telegram/validate-init-data \
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

1. Запусти backend: `docker compose up -d`
2. Створи тунель: `cloudflared tunnel --url http://localhost:4000`
3. Скопіюй HTTPS URL з виводу і задай в `.env`:
   - `API_BASE_URL=https://<your-url>`
   - `WEB_APP_URL=https://<your-url>/`
4. У BotFather встанови `/setmenubutton` на `WEB_APP_URL`.
5. Перезапусти: `docker compose up -d --build`
6. У боті виконай `/app` та відкрий кнопку Mini App (URL веде на `/`).

## Telegram Webhook (Cloudflare Tunnel)

1. Запусти backend (docker або локально).
2. Запусти тунель (backend слухає 4000):

```bash
cloudflared tunnel --url http://localhost:4000
```

3. Візьми HTTPS URL і задай:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (опційно, але рекомендується)

4. Застосуй webhook:

```bash
cd backend && npm run webhook:delete
cd backend && npm run webhook:set
cd backend && npm run webhook:info
```

Вимоги до backend:
- Telegram буде POST-ити JSON апдейти на `TELEGRAM_WEBHOOK_URL`.
- Backend відповідає `200` одразу та обробляє апдейти асинхронно.
- Якщо `TELEGRAM_WEBHOOK_SECRET` задано, backend перевіряє `X-Telegram-Bot-Api-Secret-Token`.
