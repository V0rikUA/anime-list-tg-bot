# Anime Telegram Bot + Telegram Mini App

[English](README.md) | [Русский](README.ru.md) | [Українська](README.uk.md)

Возможности бота:
- поиск аниме по нескольким API (Jikan + AniList)
- трекинг списков: просмотрено / план / избранное
- личный счетчик просмотров и суммарный счетчик друзей
- рекомендации между друзьями
- система друзей через инвайт-токен или ссылку
- Dashboard API для фронтенда/mini app
- Telegram Mini App дашборд (`/app`)

## Установка

```bash
npm install
cp .env.example .env
```

Заполни значения в `.env`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (для инвайт-ссылок)
- `DB_CLIENT` (`pg` для docker compose, `sqlite3` для локальной sqlite)
- `DATABASE_URL` (обязательно для `pg`)
- `WEB_APP_URL` (публичный URL mini app, обычно `https://your-domain/app`)
- `STARTUP_MAX_RETRIES`, `STARTUP_RETRY_DELAY_MS` (ожидание готовности DB при старте)
- `WEBAPP_AUTH_MAX_AGE_SEC` (max age для Telegram `initData`, по умолчанию 86400)

Также задай URL Mini App в BotFather:
- `/setmenubutton` -> выбери бота -> установи `WEB_APP_URL`

## Запуск (Docker + Postgres)

```bash
docker compose up --build -d
```

Backend: `http://localhost:4000`

## Запуск (без Docker)

Используй sqlite:

```bash
DB_CLIENT=sqlite3 npm start
```

## Миграции

Приложение запускает миграции автоматически при старте.

Ручной запуск:

```bash
npm run migrate
```

Внутри docker:

```bash
docker compose exec backend npm run migrate
```

## Команды Telegram

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
- `/feed` (рекомендации от друзей)
- `/invite`
- `/join <token>`
- `/friends`
- `/stats <uid>`
- `/dashboard`
- `/app`
- `/lang` (выбор языка)

## Dashboard API (для фронтенда)

- `GET /api/dashboard/:telegramUserId`
- `GET /api/users/:telegramUserId/watch-stats/:uid`
- `GET /api/users/:telegramUserId/friends`
- `GET /health`
- `GET /app` (Mini App UI)
- `POST /api/telegram/validate-init-data` (валидировать Telegram WebApp initData)
- `POST /api/webapp/dashboard` (безопасный дашборд по initData; используется Mini App)

Пример:

```bash
curl http://localhost:4000/api/dashboard/123456789
```

Пример валидации initData:

```bash
curl -X POST http://localhost:4000/api/telegram/validate-init-data \
  -H 'Content-Type: application/json' \
  -d '{"initData":"<raw tg initData string>"}'
```

## Модель данных

Таблицы `knex`:
- `users`
- `anime`
- `user_anime_lists` (`watched`, `planned`, `favorite`, `watch_count`)
- `user_recommendations`
- `friendships`
- `friend_invites`

## Быстрый тест через Cloudflared

1. Запусти backend: `docker compose up -d`
2. Подними туннель: `cloudflared tunnel --url http://localhost:4000`
3. Скопируй HTTPS URL из вывода и пропиши в `.env`:
   - `API_BASE_URL=https://<your-url>`
   - `WEB_APP_URL=https://<your-url>/app`
4. В BotFather установи `/setmenubutton` на `WEB_APP_URL`.
5. Перезапусти: `docker compose up -d --build`
6. В боте выполни `/app` и открой кнопку Mini App.

## Telegram Webhook (Cloudflare Tunnel)

1. Запусти backend (docker или локально).
2. Запусти туннель (backend слушает 4000):

```bash
cloudflared tunnel --url http://localhost:4000
```

3. Возьми HTTPS URL и задай:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (опционально, но рекомендуется)

4. Примени webhook:

```bash
cd backend && npm run webhook:delete
cd backend && npm run webhook:set
cd backend && npm run webhook:info
```

Требования к backend:
- Telegram будет POST-ить JSON апдейты на `TELEGRAM_WEBHOOK_URL`.
- Backend отвечает `200` сразу и обрабатывает апдейты асинхронно.
- Если `TELEGRAM_WEBHOOK_SECRET` задан, backend проверяет `X-Telegram-Bot-Api-Secret-Token`.
