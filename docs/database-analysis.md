# Database Analysis & Optimization Report

## Overview

- **Database**: PostgreSQL (production), SQLite3 (development)
- **ORM**: Knex.js v3.1.0
- **Total tables**: 11

## Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `users` | Telegram users |
| 2 | `anime` | Anime catalog entries |
| 3 | `user_anime_lists` | User tracking lists (watched/planned/favorite) |
| 4 | `user_recommendations` | Anime recommendations |
| 5 | `friendships` | User-to-user friendships |
| 6 | `friend_invites` | Invite tokens for adding friends |
| 7 | `watch_title_map` | Anime-to-watch-source mapping (1:1) |
| 8 | `anime_uid_aliases` | UID alias resolution |
| 9 | `user_watch_progress` | Episode watch progress tracking |
| 10 | `anime_title_roots` | Root titles for series grouping |
| 11 | `anime_title_branches` | Branch entries (seasons/parts) |

## Data Duplication Issues

### 1. Synopsis stored twice (columns + JSON)

The `anime` table stores synopsis data in both individual columns AND a JSON column:
- Columns: `synopsis_en`, `synopsis_ru`, `synopsis_uk`
- JSON: `synopsis_json` → `{en, ru, uk}`

`buildSynopsisJson()` simply copies the same values into JSON format.
`mapAnimeRow()` parses `synopsis_json` and falls back to individual columns.

**Impact**: Every write does double work. Every read parses JSON unnecessarily.

### 2. Posters stored twice (columns + JSON)

Same pattern as synopsis:
- Columns: `image_small`, `image_large`
- JSON: `posters_json` → `{small, large}`

**Impact**: Same as above — redundant storage and processing.

### 3. `title` column duplicates `title_en`

The normalizer sets `title = titleEn || titleRu || fallback`. This is always a copy of one of the i18n title columns, adding no unique information.

### 4. Identical repository code in two services

`webapp-service` and `list-service` each maintain their own repository layer with near-identical implementations of 20+ methods. These implementations diverge in subtle ways (e.g., `leftJoin` vs `join`), which can cause inconsistent behavior.

Duplicated files:
- `normalizers.js` (both services)
- `userMethods.js` (both services)
- `catalogMethods.js` (both services)
- `listMethods.js` (both services)
- `recommendationMethods.js` (both services)
- `friendMethods.js` / friend methods in `userMethods.js`
- `watchMapMethods.js` / watch map methods in `listMethods.js`
- Base repository class (`resolveCanonicalUid`, `upsertUidAliases`, `hasAliasTable`, `checkHealth`)

### 5. Triple upsert logic for anime in webapp-service

`webapp-service/src/db/catalogMethods.js` contains three methods with nearly identical upsert blocks:
- `upsertCatalog()` — bulk upsert
- `upsertAnimeInTransaction()` — single upsert within existing transaction
- `upsertAnime()` — single upsert with own transaction

Each repeats ~20 lines of `.insert(...).onConflict('uid').merge(...)`.

### 6. Watched-list logic repeated 3 times

The "if watched → delete planned, increment watch_count" logic appears in:
- `webapp-service/src/db/listMethods.js`
- `list-service/src/repository/listMethods.js`
- `list-service/src/repository/legacyListMethods.js`

## Schema Issues

### Missing indexes

- `user_anime_lists`: No index on `(user_id, list_type)` — queries filtering by both fields are common
- `user_recommendations`: No index on `anime_uid` — needed for "who else recommended this"
- `friendships`: No index on `friend_user_id` — needed for reverse friendship lookups

### watch_title_map is 1:1

`watch_title_map` uses `anime_uid` as PK, limiting each anime to one watch source. If multiple sources per anime are needed in the future, this would require a schema change.

## Optimization Recommendations

### Priority 1: Remove data duplication in schema

1. **Drop `synopsis_json` column** — keep `synopsis_en`/`synopsis_ru`/`synopsis_uk`. The JSON column adds no value.
2. **Drop `posters_json` column** — keep `image_small`/`image_large`. Same reasoning.
3. **Consider dropping `title` column** — use `title_en` as primary. If backward compat is needed, make `title` a generated/computed column or handle in application layer.

### Priority 2: Extract shared repository package

Create `packages/db` or `shared/repository` with a single implementation of:
- `normalizers.js`
- `userMethods.js`, `catalogMethods.js`, `listMethods.js`, etc.
- Base class with `resolveCanonicalUid`, `upsertUidAliases`, `checkHealth`

Both services import from the shared package instead of maintaining copies.

### Priority 3: Deduplicate upsert code

In `webapp-service/src/db/catalogMethods.js`, extract a single `_upsertAnimeRow(trx, anime)` method (as `list-service` already does) and call it from `upsertCatalog`, `upsertAnimeInTransaction`, and `upsertAnime`.

### Priority 4: Add missing indexes

```sql
CREATE INDEX idx_user_anime_lists_user_type ON user_anime_lists(user_id, list_type);
CREATE INDEX idx_user_recommendations_anime ON user_recommendations(anime_uid);
CREATE INDEX idx_friendships_friend ON friendships(friend_user_id);
```
