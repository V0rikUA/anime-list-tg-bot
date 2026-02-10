# Anime Telegram Bot + Telegram Mini App

[English](README.md) | [Русский](README.ru.md) | [Українська](README.uk.md)

Возможности бота:
- поиск аниме по нескольким API (Jikan + AniList)
- трекинг списков: просмотрено / план / избранное
- личный счетчик просмотров и суммарный счетчик друзей
- рекомендации между друзьями
- система друзей через инвайт-токен или ссылку
- Dashboard API для фронтенда/mini app
- Telegram Mini App дашборд (`/`)

## Установка

```bash
cd bot-service && npm install
cd ../webapp-service && npm install
cd ../frontend && npm install
cp .env.example .env
cp .env.local.example .env.local
```

Заполни значения в `.env`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (для инвайт-ссылок)
- `WATCH_API_URL` (URL сервиса `watch-api`, например `http://watch-api:8000`)
- `WATCH_SOURCES_ALLOWLIST` (опционально, список источников `anicli_api` через запятую)
- `DB_CLIENT` (`pg` для docker compose, `sqlite3` для локальной sqlite)
- `DATABASE_URL` (обязательно для `pg`)
- `WEB_APP_URL` (публичный URL mini app, обычно `https://your-domain/`)
- `STARTUP_MAX_RETRIES`, `STARTUP_RETRY_DELAY_MS` (ожидание готовности DB при старте)
- `WEBAPP_AUTH_MAX_AGE_SEC` (max age для Telegram `initData`, по умолчанию 86400)

Также задай URL Mini App в BotFather:
- `/setmenubutton` -> выбери бота -> установи `WEB_APP_URL`

## Запуск (Docker + Postgres)

```bash
docker compose --env-file .env.local -f docker-compose.yml -f docker/docker-compose.local.yml up --build
```

Gateway: `http://localhost:8080`

## Прод (Debian VM + Docker + Caddy, сабдомены)

В репозитории есть конфиг Caddy для сабдоменов:
- `mini.indexforge.site` -> UI Mini App (`/`) и same-origin `/api/*` + `/webhook` на gateway
- `api.indexforge.site` -> gateway (все пути)

Шаги:
1. Пропиши DNS A записи `mini.indexforge.site` и `api.indexforge.site` на IP виртуалки.
2. Открой порты `80` и `443` на firewall.
3. В `.env` задай:
   - `WEB_APP_URL=https://mini.indexforge.site/`
   - `TELEGRAM_WEBHOOK_URL=https://api.indexforge.site/webhook`
   - `TELEGRAM_WEBHOOK_SECRET=<random string>` (рекомендуется)
4. Запусти стек (наружу публикует порты только Caddy):

```bash
docker compose -f docker-compose.yml -f docker/docker-compose.proxy.yml up -d --build
```

TLS сертификаты Caddy получит автоматически и сохранит в Docker volume.

## Микросервисы (MVP) + Gateway

В репозитории используется микросервисная схема (только HTTP, без брокера):
- `gateway-service` (единая точка входа для API)
- `webapp-service` (API для Mini App: `/api/webapp/*` + dashboard)
- `bot-service` (Telegram bot + webhook receiver)
- `catalog-service` (поиск + ранжирование best-match + кэш)
- `list-service` (CRUD списков)
- `watch-api` (существующий FastAPI сервис)

Health gateway: `http://localhost:8080/healthz`

## Запуск (без Docker)

Используй sqlite (запусти сервисы отдельно):

```bash
cd webapp-service && DB_CLIENT=sqlite3 PORT=8080 npm start
```

## Миграции

Приложение запускает миграции автоматически при старте.

Ручной запуск:

```bash
cd webapp-service && npm run migrate
```

Внутри docker:

```bash
docker compose exec webapp npm run migrate
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
- `GET /` (Mini App UI)
- `POST /api/telegram/validate-init-data` (валидировать Telegram WebApp initData)
- `POST /api/webapp/dashboard` (безопасный дашборд по initData; используется Mini App)
- `POST /api/webapp/watch/search` (ссылки: поиск)
- `POST /api/webapp/watch/episodes` (ссылки: эпизоды)
- `POST /api/webapp/watch/sources` (ссылки: источники для эпизода)
- `POST /api/webapp/watch/videos` (ссылки: видео/качества)

### Ранжирование поиска watch-api

Endpoint `watch-api` `GET /v1/search` теперь сортирует верхний список `items` по релевантности ("лучшее совпадение") к запросу.

Опциональные query-параметры:
- `rank=false` чтобы отключить ранжирование и оставить порядок источника
- `rank_q=<title>` чтобы ранжировать по "каноническому" названию (при этом поиск по источнику всё равно делается по `q`)

Важно: эпизоды/серии не пересортировываются (эпизоды запрашиваются отдельно через `GET /v1/episodes`).

Пример:

```bash
curl http://localhost:8080/api/dashboard/123456789
```

Пример валидации initData:

```bash
curl -X POST http://localhost:8080/api/telegram/validate-init-data \
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

1. Запусти сервисы: `docker compose --env-file .env.local -f docker-compose.yml -f docker/docker-compose.local.yml up -d --build`
2. Запусти туннели (frontend + gateway):

```bash
./scripts/cloudflared-tunnels.sh
```

3. Возьми публичный URL Frontend из вывода и установи `WEB_APP_URL` в `.env`, затем обнови BotFather `/setmenubutton`.

## Telegram Webhook (Cloudflare Tunnel)

1. Запусти сервисы (docker или локально).
2. Запусти туннель на gateway (gateway слушает 8080):

```bash
cloudflared tunnel --url http://localhost:8080
```

3. Возьми HTTPS URL и задай:
- `TELEGRAM_WEBHOOK_URL=https://<your-subdomain>.trycloudflare.com/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random string>` (опционально, но рекомендуется)

4. Примени webhook через Telegram API:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \\
  -d "url=${TELEGRAM_WEBHOOK_URL}" \\
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Требования к bot-service:
- Telegram будет POST-ить JSON апдейты на `TELEGRAM_WEBHOOK_URL`.
- Gateway отвечает `200` сразу, а `bot-service` обрабатывает апдейты асинхронно.
- Если `TELEGRAM_WEBHOOK_SECRET` задан, `bot-service` проверяет `X-Telegram-Bot-Api-Secret-Token`.
