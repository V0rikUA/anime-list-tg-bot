# Contributing

## Reporting Issues

When opening an issue, provide specific context to minimize investigation time:

```markdown
**Service:** bot-service
**File:** bot-service/src/index.js:245
**Description:** The /search command fails when query contains Cyrillic characters
**Steps to reproduce:**
1. Send `/search Наруто` to the bot
2. Observe error in bot-service logs
**Expected:** Search results in Russian
**Actual:** 500 error, no response
```

### Issue Template Checklist

- [ ] Identify the affected **service** (bot, webapp, catalog, list, gateway, watch-api, frontend)
- [ ] Reference **exact file paths and line numbers** (e.g., `webapp-service/src/db.js:150`)
- [ ] Include **relevant log output** (strip sensitive data)
- [ ] Specify **environment** (Docker, local, K8s) and **config** (`BOT_SEARCH_MODE`, `DB_CLIENT`)
- [ ] For UI issues: include browser console errors and screenshot

## Context Guidelines

### Minimal Context (default)

For most changes, only read the files you need:

- **Bug fix in one service**: Read only that service's source files
- **UI change**: Read only the relevant `frontend/app/` page
- **Config change**: Read `.env.example` and the service's `config.js`

### Full Context

Request full context only when:

- Changing inter-service communication (gateway routes, API contracts)
- Modifying database schema (affects webapp-service + list-service)
- Updating UID mapping logic (affects catalog-service + all consumers)

### Referencing Architecture

Always read `ARCHITECTURE.md` first. It maps:
- Which service owns which responsibility
- Where to make specific types of changes
- Which files are critical vs safe to refactor

## Code Boundaries

### Requires Human Review Before Changes

| Area | Reason |
|------|--------|
| `webapp-service/src/db.js` | Core data layer, all queries depend on it |
| `list-service/src/repository.js` | Data integrity for user lists and progress |
| `catalog-service/src/merge.js` | UID deduplication affects all search results |
| `gateway-service/src/proxy.js` | Security: token injection, routing |
| All `migrations/` files | Never edit existing migrations |
| `.env.example` | Adding/removing variables affects all deployments |
| `docker-compose.yml` | Service orchestration, startup ordering |

### Safe for Automated Changes

| Area | Notes |
|------|-------|
| `frontend/app/` pages | UI components, no backend coupling |
| `frontend/lib/i18n/` | Translation strings |
| `bot-service/src/i18n.js` | Bot translation strings |
| `bot-service/src/utils/formatters.js` | Message formatting |
| `*/test/` directories | Test files |
| `README*.md` | Documentation |

## Development Workflow

### Before Making Changes

1. Read `ARCHITECTURE.md` to understand the affected service
2. Check the "Stability Markers" section for the file you're modifying
3. Run existing tests: `cd <service> && npm test`

### Making Changes

1. Create a feature branch from `main`
2. Make changes in the relevant service directory
3. Add/update tests in the service's `test/` directory
4. Run tests locally to verify
5. Test with Docker Compose if changes span services

### Database Changes

- **Never** edit existing migration files
- Create a new migration: add a `.cjs` file in the service's `migrations/` directory
- Naming convention: `YYYYMMDDHHMM_description.cjs`
- Migrations run automatically on webapp-service and list-service startup

### Adding a New Bot Command

1. Add handler in `bot-service/src/index.js`
2. Add translations in `bot-service/src/i18n.js`
3. If the command needs list data, use `listClient.js`
4. If the command needs search, use `catalogClient.js`

### Adding a New API Endpoint

1. Add route in the appropriate service's `src/index.js`
2. If it needs to be public, add gateway route in `gateway-service/src/proxy.js`
3. Add frontend API route in `frontend/app/api/` if consumed by Mini App

## Testing

```bash
# Node services (uses built-in Node test runner)
cd bot-service && npm test
cd webapp-service && npm test
cd catalog-service && npm test
cd list-service && npm test

# Python service
cd watch-api && python -m pytest

# Full stack (Docker)
docker compose --env-file .env.local -f docker-compose.yml -f docker/docker-compose.local.yml up --build
```
