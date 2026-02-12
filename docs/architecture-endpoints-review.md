# Architecture endpoint + data-flow review (gateway-first)

## Scope
This document maps:
- exposed endpoints per service,
- inter-service links,
- expected API Gateway routing,
- DB ownership boundaries,
- key review notes from the current refactor wave.

## Gateway routing contract
`gateway-service` is the external entrypoint and routes requests as follows:

- `POST /webhook` -> `bot-service` webhook path
- `GET /api/v1/catalog/search` -> `catalog-service /v1/catalog/search`
- `/api/v1/list/*` -> `list-service /v1/list/*`
- `/api/watch/*` -> `watch-api /*`
- `/api/*` -> `webapp-service /api/*`

This contract is implemented in `gateway-service/src/index.js` and should remain the only public ingress path.

## Service endpoint inventory

### gateway-service
- `GET /healthz`
- `POST /webhook`
- `GET /api/v1/catalog/search`
- `ALL /api/v1/list`
- `ALL /api/v1/list/*`
- `ALL /api/watch`
- `ALL /api/watch/*`
- `ALL /api/*`

### webapp-service
- `GET /healthz`, `GET /health`
- `POST /api/telegram/validate-init-data`
- `POST /api/webapp/dashboard`
- `POST /api/webapp/invite`
- `POST /api/webapp/lang`
- `POST /api/webapp/search`
- `POST /api/webapp/list/add`, `POST /api/webapp/list/remove`
- `POST /api/webapp/recommend/add`
- `POST /api/webapp/watch/search|bind|unbind|providers|episodes|sources|videos|progress/start`
- debug/legacy: `GET /api/dashboard/:telegramUserId`, `GET /api/users/:telegramUserId/watch-stats/:uid`, `GET /api/users/:telegramUserId/friends`

### list-service
- `GET /healthz`
- `GET /v1/list/:userId`
- `POST /v1/list/:userId/items`
- `PATCH /v1/list/:userId/items/:itemId`
- `DELETE /v1/list/:userId/items/:itemId`
- `POST /v1/list/:userId/progress/start`
- `GET /v1/list/:userId/progress/recent`
- `DELETE /v1/list/:userId/progress/:animeUid`

### catalog-service
- `GET /healthz`
- `GET /v1/catalog/search`

### watch-api (FastAPI)
- `GET /v1/health`
- `GET /v1/sources`
- `GET /v1/search`
- `GET /v1/episodes`
- `GET /v1/sources-for-episode`
- `GET /v1/videos`

### bot-service
- Telegram webhook lifecycle + bot command/callback handlers (Telegraf)
- health endpoints in service runtime (not public app API used by frontend)

## Inter-service links (after gateway-first refactor defaults)

### webapp-service outgoing
- catalog search calls: `${CATALOG_SERVICE_URL||API_GATEWAY_URL+'/api'}/v1/catalog/search`
- list calls: `${LIST_SERVICE_URL||API_GATEWAY_URL+'/api'}/v1/list/...`
- watch calls: `${WATCH_API_URL||API_GATEWAY_URL+'/api/watch'}/v1/...`

### bot-service outgoing
- catalog calls: `${CATALOG_SERVICE_URL||API_GATEWAY_URL+'/api'}/v1/catalog/search`
- list calls: `${LIST_SERVICE_URL||API_GATEWAY_URL+'/api'}/v1/list/...`
- watch calls: `${WATCH_API_URL||API_GATEWAY_URL+'/api/watch'}/v1/...`

`CATALOG_SERVICE_URL/LIST_SERVICE_URL/WATCH_API_URL` still allow explicit overrides for compatibility, but defaults now enforce gateway pathing.

## DB ownership map

### webapp-service DB
Owns user/profile/social/catalog metadata tables including:
- `users`, `anime`, `user_anime_lists`, `user_recommendations`, `friendships`, `friend_invites`
- `watch_title_map`, `anime_uid_aliases`, `user_watch_progress`
- `anime_title_roots`, `anime_title_branches`

### bot-service DB
Tracks bot-side user/list/reco state and now includes same migration lineage for:
- `synopsis_json`, `posters_json` in `anime`
- `anime_title_roots`, `anime_title_branches`

### list-service DB
Owns canonical list/progress APIs (`/v1/list/*`) for watch-progress and list operations.

### catalog-service
No persistent DB in current code path; aggregates external sources and ranks/caches in-memory.

### watch-api
No persistent DB; runtime in-memory refs/cache only.

## Code review notes

1. **Gateway-only ingress is clear and correct** in gateway route map.
2. **Direct service-to-service links were a drift risk**; defaults now point to gateway while preserving env override compatibility.
3. **watch search robustness**: webapp flow now protects against placeholder titles and retries without pinned source on 5xx.
4. **Migration lineage consistency**: bot-service migration directory now includes missing migration files referenced in `knex_migrations`.

## Follow-up recommendations

- Add lightweight integration test to assert gateway route contract (`/api/v1/catalog/search`, `/api/v1/list/*`, `/api/watch/*`, `/api/*`).
- Add startup diagnostic log in webapp/bot printing resolved upstream base URLs (gateway vs explicit override).
- Consider deprecating direct service URL env vars once gateway-first rollout is fully stable.


## Gateway-first deployment note

Compose defaults for `webapp` and `bot` should set `API_GATEWAY_URL=http://gateway:8080` and keep service-specific URLs empty unless an explicit override is required for troubleshooting.
