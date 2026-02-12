import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import knex from 'knex';
import { normalizeLang, translateText } from './services/translate.js';

const TRACK_LIST_TYPES = new Set(['watched', 'planned', 'favorite']);
const SUPPORTED_LANGS = new Set(['en', 'ru', 'uk']);

function normalizeStoredLang(raw) {
  const lang = normalizeLang(raw);
  return SUPPORTED_LANGS.has(lang) ? lang : 'en';
}

/**
 * @typedef {Object} AnimeRow
 * @property {string} uid
 * @property {string|null} source
 * @property {string|null} externalId
 * @property {string} title
 * @property {string|null} titleEn
 * @property {string|null} titleRu
 * @property {string|null} titleUk
 * @property {number|null} episodes
 * @property {number|null} score
 * @property {string|null} status
 * @property {string|null} url
 * @property {string|null} imageSmall
 * @property {string|null} imageLarge
 * @property {string|null} synopsisEn
 * @property {string|null} synopsisRu
 * @property {string|null} synopsisUk
 * @property {string[]|null} legacyUids
 */

/**
 * Normalizes anime payload before persisting into DB.
 * @param {any} item
 * @returns {AnimeRow}
 */
function normalizeAnime(item) {
  const titleFallback = String(item?.title || '').trim();
  const titleEn = String(item?.titleEn ?? '').trim() || titleFallback;
  const titleRu = String(item?.titleRu ?? '').trim();
  const titleUk = String(item?.titleUk ?? '').trim();
  const synopsisEn = String(item?.synopsisEn ?? item?.synopsis?.en ?? '').trim();
  const synopsisRu = String(item?.synopsisRu ?? item?.synopsis?.ru ?? '').trim();
  const synopsisUk = String(item?.synopsisUk ?? item?.synopsis?.uk ?? '').trim();
  const imageSmall = item?.imageSmall ?? item?.posters?.small ?? null;
  const imageLarge = item?.imageLarge ?? item?.posters?.large ?? null;

  const rawLegacyUids = Array.isArray(item?.legacyUids) ? item.legacyUids : [];
  const legacyUids = rawLegacyUids
    .map((uid) => String(uid || '').trim())
    .filter(Boolean);

  return {
    uid: String(item.uid),
    source: item.source || null,
    externalId: item.externalId === undefined || item.externalId === null ? null : String(item.externalId),
    // Keep legacy `title` aligned with EN for stability.
    title: titleEn || titleRu || titleFallback || 'Unknown title',
    titleEn: titleEn || null,
    titleRu: titleRu || null,
    titleUk: titleUk || null,
    episodes: item.episodes ?? null,
    score: item.score ?? null,
    status: item.status ?? null,
    url: item.url ?? null,
    imageSmall: imageSmall ?? null,
    imageLarge: imageLarge ?? null,
    synopsisEn: synopsisEn || null,
    synopsisRu: synopsisRu || null,
    synopsisUk: synopsisUk || null,
    legacyUids: legacyUids.length ? legacyUids : null
  };
}

function parseJsonField(raw, fallback) {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function buildSynopsisJson(anime) {
  return {
    en: anime?.synopsisEn ?? null,
    ru: anime?.synopsisRu ?? null,
    uk: anime?.synopsisUk ?? null
  };
}

function buildPostersJson(anime) {
  return {
    small: anime?.imageSmall ?? null,
    large: anime?.imageLarge ?? null
  };
}

/**
 * Maps a DB row into API shape.
 * @param {any} row
 * @returns {AnimeRow & {addedAt: string|null, watchCount: number}}
 */
function mapAnimeRow(row) {
  const synopsis = parseJsonField(row.synopsis_json, buildSynopsisJson({
    synopsisEn: row.synopsis_en ?? null,
    synopsisRu: row.synopsis_ru ?? null,
    synopsisUk: row.synopsis_uk ?? null
  }));
  const posters = parseJsonField(row.posters_json, buildPostersJson({
    imageSmall: row.image_small ?? null,
    imageLarge: row.image_large ?? null
  }));

  return {
    uid: row.uid,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    titleEn: row.title_en ?? null,
    titleRu: row.title_ru ?? null,
    titleUk: row.title_uk ?? null,
    episodes: row.episodes,
    score: row.score,
    status: row.status,
    url: row.url,
    imageSmall: row.image_small ?? null,
    imageLarge: row.image_large ?? null,
    synopsisEn: row.synopsis_en ?? null,
    synopsisRu: row.synopsis_ru ?? null,
    synopsisUk: row.synopsis_uk ?? null,
    synopsis,
    posters,
    addedAt: row.added_at || null,
    watchCount: row.watch_count ?? 0
  };
}

function safeFriendName(row) {
  return row.username || row.first_name || `user_${row.telegram_id}`;
}

function pickTitleByLang(anime, langRaw) {
  const lang = normalizeStoredLang(langRaw);
  const en = String(anime?.titleEn || anime?.title_en || anime?.title || '').trim();
  const ru = String(anime?.titleRu || anime?.title_ru || '').trim();
  const uk = String(anime?.titleUk || anime?.title_uk || '').trim();

  if (lang === 'ru' && ru) return ru;
  if (lang === 'uk' && uk) return uk;
  return en || ru || uk || 'Unknown title';
}

function parseUidForStub(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const match = uid.match(/^(jikan|shikimori|anilist|mal):(\d+)$/i);
  if (!match) return { uid, source: null, externalId: null };
  return {
    uid,
    source: String(match[1] || '').toLowerCase(),
    externalId: String(match[2] || '').trim() || null
  };
}

function normalizeTitleForIndex(titleRaw) {
  return String(titleRaw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRootTitle(titleRaw) {
  const normalized = normalizeTitleForIndex(titleRaw);
  if (!normalized) return '';

  const cutPatterns = [
    /\b(first|second|third|fourth|fifth|final)\s+(stage|season|part)\b/i,
    /\b\d+\s*(st|nd|rd|th)?\s*(season|stage|part)\b/i,
    /\b(ova|ona|movie|film|special|sp|extra|battle\s+stage|project\s+d)\b/i,
    /(^|\s)(перв(ый|ая|ое)|втор(ой|ая|ое)|трет(ий|ья|ье)|финал(ьн(ый|ая|ое))?)\s+(этап|сезон|часть)(\s|$)/iu,
    /(^|\s)\d+\s*(сезон|этап|часть)(\s|$)/iu,
    /(^|\s)(фильм|спецвыпуск|спешл|ова|она|экстра|боевая\s+стадия|проект\s+ди)(\s|$)/iu
  ];

  let cutAt = normalized.length;
  for (const pattern of cutPatterns) {
    const match = normalized.match(pattern);
    if (match && typeof match.index === 'number') {
      cutAt = Math.min(cutAt, match.index);
    }
  }

  const root = normalizeTitleForIndex(normalized.slice(0, cutAt));
  return root || normalized;
}

function deriveTitleIndexPayload(anime) {
  const rawTitle = anime?.titleEn || anime?.title || anime?.titleRu || anime?.titleUk || '';
  const branchTitle = String(rawTitle || '').trim() || 'Unknown title';
  const branchTitleNormalized = normalizeTitleForIndex(branchTitle);
  const rootTitleNormalized = extractRootTitle(branchTitle) || branchTitleNormalized;
  const rootTitle = rootTitleNormalized || branchTitle;

  return {
    rootKey: rootTitleNormalized || branchTitleNormalized || `uid:${anime?.uid}`,
    rootTitle,
    rootTitleNormalized,
    branchTitle,
    branchTitleNormalized
  };
}

async function ensureTitlesI18n(animeRaw) {
  const anime = normalizeAnime(animeRaw);
  const base = String(anime.titleEn || anime.title || '').trim();
  if (!base) return anime;

  const ru = anime.titleRu
    ? anime.titleRu
    : await translateText(base, { from: 'en', to: 'ru' }).catch(() => '');

  const ukFrom = anime.titleRu || ru || base;
  const uk = anime.titleUk
    ? anime.titleUk
    : await translateText(
      ukFrom,
      { from: anime.titleRu || ru ? 'ru' : 'en', to: 'uk' }
    ).catch(() => '');

  const synopsisEnBase = String(anime.synopsisEn || '').trim();
  const synopsisRu = anime.synopsisRu
    ? anime.synopsisRu
    : (synopsisEnBase
      ? await translateText(synopsisEnBase, { from: 'en', to: 'ru' }).catch(() => '')
      : '');

  const synopsisUk = anime.synopsisUk
    ? anime.synopsisUk
    : (
      synopsisRu
        ? await translateText(synopsisRu, { from: 'ru', to: 'uk' }).catch(() => '')
        : (synopsisEnBase
          ? await translateText(synopsisEnBase, { from: 'en', to: 'uk' }).catch(() => '')
          : '')
    );

  return {
    ...anime,
    title: base,
    titleEn: anime.titleEn || base,
    titleRu: anime.titleRu || (ru || null),
    titleUk: anime.titleUk || (uk || null),
    synopsisEn: synopsisEnBase || null,
    synopsisRu: anime.synopsisRu || (synopsisRu || null),
    synopsisUk: anime.synopsisUk || (synopsisUk || null)
  };
}

export { normalizeTitleForIndex, extractRootTitle, deriveTitleIndexPayload };

export class AnimeRepository {
  constructor(options) {
    this.client = options.client || 'sqlite3';
    this.dbPath = options.dbPath || null;
    this.databaseUrl = options.databaseUrl || null;

    const knexConfig = {
      client: this.client,
      migrations: {
        directory: path.resolve('migrations'),
        extension: 'cjs',
        loadExtensions: ['.cjs']
      }
    };

    if (this.client === 'sqlite3') {
      knexConfig.connection = {
        filename: this.dbPath
      };
      knexConfig.useNullAsDefault = true;
      knexConfig.pool = {
        afterCreate(connection, done) {
          connection.run('PRAGMA foreign_keys = ON', done);
        }
      };
    } else if (this.client === 'pg') {
      knexConfig.connection = this.databaseUrl;
      knexConfig.pool = { min: 0, max: 10 };
    } else {
      throw new Error(`Unsupported DB client: ${this.client}`);
    }

    this.db = knex(knexConfig);
    this._hasAliasTable = null;
    this._hasTitleRootsTable = null;
    this._hasTitleBranchesTable = null;
  }

  async hasAliasTable() {
    if (this._hasAliasTable !== null) return this._hasAliasTable;
    try {
      this._hasAliasTable = await this.db.schema.hasTable('anime_uid_aliases');
    } catch {
      this._hasAliasTable = false;
    }
    return this._hasAliasTable;
  }

  async hasTitleRootsTable() {
    if (this._hasTitleRootsTable !== null) return this._hasTitleRootsTable;
    try {
      this._hasTitleRootsTable = await this.db.schema.hasTable('anime_title_roots');
    } catch {
      this._hasTitleRootsTable = false;
    }
    return this._hasTitleRootsTable;
  }

  async hasTitleBranchesTable() {
    if (this._hasTitleBranchesTable !== null) return this._hasTitleBranchesTable;
    try {
      this._hasTitleBranchesTable = await this.db.schema.hasTable('anime_title_branches');
    } catch {
      this._hasTitleBranchesTable = false;
    }
    return this._hasTitleBranchesTable;
  }

  async upsertTitleIndex(trx, anime) {
    const hasRoots = await this.hasTitleRootsTable();
    const hasBranches = await this.hasTitleBranchesTable();
    if (!hasRoots || !hasBranches) return;

    const payload = deriveTitleIndexPayload(anime);

    await trx('anime_title_roots').insert({
      root_key: payload.rootKey,
      title_main: payload.rootTitle,
      title_main_normalized: payload.rootTitleNormalized,
      updated_at: this.db.fn.now()
    }).onConflict('root_key').merge({
      title_main: this.db.raw('excluded.title_main'),
      title_main_normalized: this.db.raw('excluded.title_main_normalized'),
      updated_at: this.db.fn.now()
    });

    const root = await trx('anime_title_roots').where({ root_key: payload.rootKey }).first('id');
    if (!root?.id) return;

    await trx('anime_title_branches').insert({
      root_id: root.id,
      anime_uid: anime.uid,
      branch_title: payload.branchTitle,
      branch_title_normalized: payload.branchTitleNormalized,
      updated_at: this.db.fn.now()
    }).onConflict('anime_uid').merge({
      root_id: this.db.raw('excluded.root_id'),
      branch_title: this.db.raw('excluded.branch_title'),
      branch_title_normalized: this.db.raw('excluded.branch_title_normalized'),
      updated_at: this.db.fn.now()
    });
  }

  async resolveCanonicalUid(uidRaw) {
    const uid = String(uidRaw || '').trim();
    if (!uid) return '';
    if (!(await this.hasAliasTable())) return uid;
    try {
      const row = await this.db('anime_uid_aliases')
        .where({ alias_uid: uid })
        .select('canonical_uid')
        .first();
      return row?.canonical_uid ? String(row.canonical_uid) : uid;
    } catch {
      return uid;
    }
  }

  async upsertUidAliases(trx, canonicalUidRaw, aliasesRaw) {
    const canonicalUid = String(canonicalUidRaw || '').trim();
    if (!canonicalUid) return;
    if (!(await this.hasAliasTable())) return;

    const aliases = Array.isArray(aliasesRaw)
      ? aliasesRaw.map((uid) => String(uid || '').trim()).filter(Boolean)
      : [];
    if (!aliases.length) return;

    const rows = aliases
      .filter((aliasUid) => aliasUid !== canonicalUid)
      .map((aliasUid) => ({
        alias_uid: aliasUid,
        canonical_uid: canonicalUid,
        updated_at: this.db.fn.now()
      }));

    if (!rows.length) return;

    await trx('anime_uid_aliases').insert(rows).onConflict('alias_uid').merge({
      canonical_uid: this.db.raw('excluded.canonical_uid'),
      updated_at: this.db.fn.now()
    });
  }

  async init() {
    if (this.client === 'sqlite3') {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    }
    await this.runMigrations();
  }

  async destroy() {
    await this.db.destroy();
  }

  async runMigrations() {
    await this.db.migrate.latest();
  }

  async checkHealth() {
    try {
      await this.db.raw('select 1 as ok');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  async ensureUser(telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.language_code);
    const payload = {
      telegram_id: String(telegramUser.id),
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name ?? null,
      last_name: telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    // Do not override lang on existing user; only fill it on first insert.
    const mergePayload = {
      username: payload.username,
      first_name: payload.first_name,
      last_name: payload.last_name,
      updated_at: payload.updated_at
    };

    await this.db('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    const user = await this.db('users').where({ telegram_id: payload.telegram_id }).first();

    if (user && !user.lang && guessedLang) {
      await this.db('users')
        .where({ telegram_id: payload.telegram_id })
        .update({ lang: guessedLang, updated_at: this.db.fn.now() });
      return this.db('users').where({ telegram_id: payload.telegram_id }).first();
    }

    return user;
  }

  async getUserByTelegramId(telegramId) {
    return this.db('users').where({ telegram_id: String(telegramId) }).first();
  }

  async setUserLang(telegramId, langRaw) {
    const lang = normalizeStoredLang(langRaw);
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return { ok: false, reason: 'user_not_found' };
    }

    await this.db('users')
      .where({ telegram_id: String(telegramId) })
      .update({ lang, updated_at: this.db.fn.now() });

    return { ok: true, lang };
  }

  async getFriends(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const rows = await this.db('friendships as f')
      .join('users as u', 'u.id', 'f.friend_user_id')
      .where('f.user_id', user.id)
      .orderBy('u.username', 'asc')
      .select('u.telegram_id', 'u.username', 'u.first_name', 'u.last_name');

    return rows.map((row) => ({
      telegramId: row.telegram_id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      label: safeFriendName(row)
    }));
  }

  async createInviteToken(telegramUser) {
    const user = await this.ensureUser(telegramUser);
    const existing = await this.db('friend_invites')
      .where({ inviter_user_id: user.id })
      .first();

    // Stable per-user token (unique per inviter, not per request).
    if (existing?.token) {
      return existing.token;
    }

    // Extremely unlikely to hit token collisions, but keep it safe.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex');
      try {
        await this.db('friend_invites').insert({
          inviter_user_id: user.id,
          token
        });
        return token;
      } catch (error) {
        // If inviter row was created concurrently, reuse it.
        const invite = await this.db('friend_invites')
          .where({ inviter_user_id: user.id })
          .first();
        if (invite?.token) {
          return invite.token;
        }
        // Otherwise retry token generation (e.g. rare token unique violation).
      }
    }

    throw new Error('Failed to generate invite token');
  }

  async addFriendByToken(telegramUser, tokenRaw) {
    const token = String(tokenRaw || '').trim();
    if (!token) {
      return { ok: false, reason: 'invalid_token' };
    }

    return this.db.transaction(async (trx) => {
      const joinerPayload = {
        telegram_id: String(telegramUser.id),
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        updated_at: this.db.fn.now()
      };

      await trx('users').insert(joinerPayload).onConflict('telegram_id').merge(joinerPayload);
      const joiner = await trx('users').where({ telegram_id: joinerPayload.telegram_id }).first();

      const invite = await trx('friend_invites as i')
        .join('users as u', 'u.id', 'i.inviter_user_id')
        .where('i.token', token)
        .select('i.inviter_user_id', 'u.telegram_id', 'u.username', 'u.first_name', 'u.last_name')
        .first();

      if (!invite) {
        return { ok: false, reason: 'invalid_token' };
      }

      if (invite.inviter_user_id === joiner.id) {
        return { ok: false, reason: 'self_friend' };
      }

      await trx('friendships').insert({ user_id: joiner.id, friend_user_id: invite.inviter_user_id })
        .onConflict(['user_id', 'friend_user_id']).ignore();
      await trx('friendships').insert({ user_id: invite.inviter_user_id, friend_user_id: joiner.id })
        .onConflict(['user_id', 'friend_user_id']).ignore();

      return {
        ok: true,
        inviter: {
          telegramId: invite.telegram_id,
          username: invite.username,
          firstName: invite.first_name,
          lastName: invite.last_name,
          label: safeFriendName(invite)
        }
      };
    });
  }

  async upsertCatalog(items) {
    if (!items.length) {
      return;
    }

    const normalizedItems = await Promise.all(items.map((item) => ensureTitlesI18n(item)));

    await this.db.transaction(async (trx) => {
      const rows = normalizedItems.map((normalized) => {
        const synopsis = buildSynopsisJson(normalized);
        const posters = buildPostersJson(normalized);
        return {
          uid: normalized.uid,
          source: normalized.source,
          external_id: normalized.externalId,
          title: normalized.title,
          title_en: normalized.titleEn,
          title_ru: normalized.titleRu,
          title_uk: normalized.titleUk,
          episodes: normalized.episodes,
          score: normalized.score,
          status: normalized.status,
          url: normalized.url,
          image_small: normalized.imageSmall,
          image_large: normalized.imageLarge,
          synopsis_en: normalized.synopsisEn,
          synopsis_ru: normalized.synopsisRu,
          synopsis_uk: normalized.synopsisUk,
          synopsis_json: JSON.stringify(synopsis),
          posters_json: JSON.stringify(posters),
          updated_at: this.db.fn.now()
        };
      });

      await trx('anime').insert(rows).onConflict('uid').merge({
        source: this.db.raw('excluded.source'),
        external_id: this.db.raw('excluded.external_id'),
        title: this.db.raw('excluded.title'),
        title_en: this.db.raw('excluded.title_en'),
        title_ru: this.db.raw('excluded.title_ru'),
        title_uk: this.db.raw('excluded.title_uk'),
        episodes: this.db.raw('excluded.episodes'),
        score: this.db.raw('excluded.score'),
        status: this.db.raw('excluded.status'),
        url: this.db.raw('excluded.url'),
        image_small: this.db.raw('excluded.image_small'),
        image_large: this.db.raw('excluded.image_large'),
        synopsis_en: this.db.raw('excluded.synopsis_en'),
        synopsis_ru: this.db.raw('excluded.synopsis_ru'),
        synopsis_uk: this.db.raw('excluded.synopsis_uk'),
        synopsis_json: this.db.raw('excluded.synopsis_json'),
        posters_json: this.db.raw('excluded.posters_json'),
        updated_at: this.db.fn.now()
      });

      for (const normalized of normalizedItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.upsertUidAliases(
          trx,
          normalized.uid,
          [normalized.uid, ...(normalized.legacyUids || [])]
        );
        // eslint-disable-next-line no-await-in-loop
        await this.upsertTitleIndex(trx, normalized);
      }
    });
  }

  async getCatalogItem(uid) {
    const canonicalUid = await this.resolveCanonicalUid(uid);
    const row = await this.db('anime').where({ uid: canonicalUid }).first();
    return row ? mapAnimeRow(row) : null;
  }

  async ensureAnimeStub(uidRaw) {
    const canonicalUid = await this.resolveCanonicalUid(uidRaw);
    if (!canonicalUid) return null;

    const existing = await this.db('anime').where({ uid: canonicalUid }).first();
    if (existing) return mapAnimeRow(existing);

    const parsed = parseUidForStub(canonicalUid);
    const synopsis = buildSynopsisJson({});
    const posters = buildPostersJson({});
    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: parsed.uid,
        source: parsed.source,
        external_id: parsed.externalId,
        title: 'Unknown title',
        synopsis_json: JSON.stringify(synopsis),
        posters_json: JSON.stringify(posters),
        updated_at: this.db.fn.now()
      }).onConflict('uid').ignore();
      await this.upsertTitleIndex(trx, { uid: parsed.uid, title: 'Unknown title', titleEn: 'Unknown title' });
    });

    const created = await this.db('anime').where({ uid: canonicalUid }).first();
    return created ? mapAnimeRow(created) : null;
  }


  async indexAnimeInteraction(uidRaw, { title = null } = {}) {
    const canonicalUid = await this.resolveCanonicalUid(uidRaw);
    if (!canonicalUid) return null;

    const existing = await this.db('anime').where({ uid: canonicalUid }).first();
    const cleanTitle = String(title || '').trim();
    const fallbackTitle = cleanTitle || existing?.title || 'Unknown title';

    const parsed = parseUidForStub(canonicalUid);
    const synopsis = buildSynopsisJson({
      synopsisEn: existing?.synopsis_en ?? null,
      synopsisRu: existing?.synopsis_ru ?? null,
      synopsisUk: existing?.synopsis_uk ?? null
    });
    const posters = buildPostersJson({
      imageSmall: existing?.image_small ?? null,
      imageLarge: existing?.image_large ?? null
    });

    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: parsed.uid,
        source: parsed.source,
        external_id: parsed.externalId,
        title: fallbackTitle,
        title_en: cleanTitle || null,
        synopsis_json: JSON.stringify(synopsis),
        posters_json: JSON.stringify(posters),
        updated_at: this.db.fn.now()
      }).onConflict('uid').merge({
        source: this.db.raw('coalesce(source, excluded.source)'),
        external_id: this.db.raw('coalesce(external_id, excluded.external_id)'),
        updated_at: this.db.fn.now()
      });

      if (cleanTitle) {
        await trx('anime')
          .where({ uid: parsed.uid })
          .andWhere((qb) => qb.whereNull('title').orWhere('title', 'Unknown title'))
          .update({ title: cleanTitle, title_en: cleanTitle, updated_at: this.db.fn.now() });
      }

      await this.upsertTitleIndex(trx, { uid: parsed.uid, title: fallbackTitle, titleEn: cleanTitle || fallbackTitle });
    });

    const row = await this.db('anime').where({ uid: canonicalUid }).first();
    return row ? mapAnimeRow(row) : null;
  }

  async getCatalogItemLocalized(uid, lang) {
    const item = await this.getCatalogItem(uid);
    if (!item) return null;
    return { ...item, title: pickTitleByLang(item, lang) };
  }

  async getCatalogItemsLocalized(uidsRaw, lang) {
    const uids = Array.isArray(uidsRaw) ? uidsRaw.map((u) => String(u || '').trim()).filter(Boolean) : [];
    if (!uids.length) return [];
    const resolvedUids = Array.from(new Set(await Promise.all(uids.map((uid) => this.resolveCanonicalUid(uid)))))
      .filter(Boolean);
    if (!resolvedUids.length) return [];
    const rows = await this.db('anime').whereIn('uid', resolvedUids);
    const items = rows.map((row) => mapAnimeRow(row));
    return items.map((it) => ({ ...it, title: pickTitleByLang(it, lang) }));
  }

  async getWatchMap(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return null;
    const row = await this.db('watch_title_map').where({ anime_uid: uid }).first();
    if (!row) return null;
    return {
      uid,
      watchSource: row.watch_source,
      watchUrl: row.watch_url,
      watchTitle: row.watch_title || null,
      updatedAt: row.updated_at || null
    };
  }

  async setWatchMap(uidRaw, watchSourceRaw, watchUrlRaw, watchTitleRaw = null) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    const watchSource = String(watchSourceRaw || '').trim().toLowerCase();
    const watchUrl = String(watchUrlRaw || '').trim();
    const watchTitle = watchTitleRaw === null || watchTitleRaw === undefined ? null : String(watchTitleRaw).trim();

    if (!uid) throw new Error('uid is required');
    if (!watchSource) throw new Error('watchSource is required');
    if (!watchUrl) throw new Error('watchUrl is required');

    const anime = await this.getCatalogItem(uid);
    if (!anime) {
      throw new Error('anime_not_found');
    }

    await this.db('watch_title_map').insert({
      anime_uid: uid,
      watch_source: watchSource,
      watch_url: watchUrl,
      watch_title: watchTitle,
      updated_at: this.db.fn.now()
    }).onConflict('anime_uid').merge({
      watch_source: this.db.raw('excluded.watch_source'),
      watch_url: this.db.raw('excluded.watch_url'),
      watch_title: this.db.raw('excluded.watch_title'),
      updated_at: this.db.fn.now()
    });

    return { ok: true };
  }

  async clearWatchMap(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return { ok: false };
    await this.db('watch_title_map').where({ anime_uid: uid }).del();
    return { ok: true };
  }

  async addToTrackedList(telegramUser, listType, anime) {
    if (!TRACK_LIST_TYPES.has(listType)) {
      throw new Error(`Unsupported list type: ${listType}`);
    }

    const normalizedAnime = normalizeAnime(anime);
    normalizedAnime.uid = await this.resolveCanonicalUid(normalizedAnime.uid);

    await this.db.transaction(async (trx) => {
      const user = await this.ensureUserInTransaction(trx, telegramUser);
      await this.upsertAnimeInTransaction(trx, normalizedAnime);
      await this.upsertUidAliases(
        trx,
        normalizedAnime.uid,
        [normalizedAnime.uid, ...(normalizedAnime.legacyUids || [])]
      );

      if (listType === 'watched') {
        await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: normalizedAnime.uid, list_type: 'planned' })
          .del();

        const existing = await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: normalizedAnime.uid, list_type: 'watched' })
          .first();

        if (existing) {
          await trx('user_anime_lists')
            .where({ id: existing.id })
            .update({
              watch_count: Number(existing.watch_count || 0) + 1,
              added_at: this.db.fn.now()
            });
        } else {
          await trx('user_anime_lists').insert({
            user_id: user.id,
            anime_uid: normalizedAnime.uid,
            list_type: 'watched',
            watch_count: 1
          });
        }

        return;
      }

      await trx('user_anime_lists').insert({
        user_id: user.id,
        anime_uid: normalizedAnime.uid,
        list_type: listType,
        watch_count: 0
      }).onConflict(['user_id', 'anime_uid', 'list_type']).ignore();
    });
  }

  async removeFromTrackedList(telegramId, listType, uid) {
    if (!TRACK_LIST_TYPES.has(listType)) {
      throw new Error(`Unsupported list type: ${listType}`);
    }

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return false;
    }

    const canonicalUid = await this.resolveCanonicalUid(uid);
    const affectedRows = await this.db('user_anime_lists')
      .where({
        user_id: user.id,
        anime_uid: String(canonicalUid),
        list_type: listType
      })
      .del();

    return affectedRows > 0;
  }

  async getTrackedList(telegramId, listType) {
    if (!TRACK_LIST_TYPES.has(listType)) {
      throw new Error(`Unsupported list type: ${listType}`);
    }

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const rows = await this.db('user_anime_lists as l')
      .leftJoin('anime as a', 'a.uid', 'l.anime_uid')
      .where({ user_id: user.id, list_type: listType })
      .orderBy('l.added_at', 'desc')
      .select(
        'a.uid',
        'a.source',
        'a.external_id',
        'a.title',
        'a.title_en',
        'a.title_ru',
        'a.title_uk',
        'a.episodes',
        'a.score',
        'a.status',
        'a.url',
        'a.image_small',
        'a.image_large',
        'a.synopsis_en',
        'a.synopsis_ru',
        'a.synopsis_uk',
        'a.synopsis_json',
        'a.posters_json',
        'l.anime_uid as list_anime_uid',
        'l.added_at',
        'l.watch_count'
      );

    const lang = user.lang || 'en';
    return rows.map((r) => {
      const mapped = mapAnimeRow({ ...r, uid: r.uid || r.list_anime_uid });
      return { ...mapped, title: pickTitleByLang(mapped, lang) };
    });
  }

  async addRecommendation(telegramUser, anime) {
    const normalizedAnime = normalizeAnime(anime);
    normalizedAnime.uid = await this.resolveCanonicalUid(normalizedAnime.uid);

    await this.db.transaction(async (trx) => {
      const user = await this.ensureUserInTransaction(trx, telegramUser);
      await this.upsertAnimeInTransaction(trx, normalizedAnime);
      await this.upsertUidAliases(
        trx,
        normalizedAnime.uid,
        [normalizedAnime.uid, ...(normalizedAnime.legacyUids || [])]
      );

      await trx('user_recommendations').insert({
        recommender_user_id: user.id,
        anime_uid: normalizedAnime.uid
      }).onConflict(['recommender_user_id', 'anime_uid']).ignore();
    });
  }

  async removeRecommendation(telegramId, uid) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return false;
    }

    const canonicalUid = await this.resolveCanonicalUid(uid);
    const affectedRows = await this.db('user_recommendations')
      .where({ recommender_user_id: user.id, anime_uid: String(canonicalUid) })
      .del();

    return affectedRows > 0;
  }

  async getOwnRecommendations(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const rows = await this.db('user_recommendations as r')
      .leftJoin('anime as a', 'a.uid', 'r.anime_uid')
      .where({ recommender_user_id: user.id })
      .orderBy('r.created_at', 'desc')
      .select(
        'a.uid',
        'a.source',
        'a.external_id',
        'a.title',
        'a.title_en',
        'a.title_ru',
        'a.title_uk',
        'a.episodes',
        'a.score',
        'a.status',
        'a.url',
        'a.image_small',
        'a.image_large',
        'a.synopsis_en',
        'a.synopsis_ru',
        'a.synopsis_uk',
        'a.synopsis_json',
        'a.posters_json',
        'r.anime_uid as list_anime_uid',
        'r.created_at as added_at'
      );

    const lang = user.lang || 'en';
    return rows.map((r) => {
      const mapped = mapAnimeRow({ ...r, uid: r.uid || r.list_anime_uid });
      return { ...mapped, title: pickTitleByLang(mapped, lang) };
    });
  }

  async getRecommendationsFromFriends(telegramId, limit = 25) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const rows = await this.db('user_recommendations as r')
      .leftJoin('anime as a', 'a.uid', 'r.anime_uid')
      .join('users as u', 'u.id', 'r.recommender_user_id')
      .join('friendships as f', 'f.friend_user_id', 'r.recommender_user_id')
      .where('f.user_id', user.id)
      .orderBy('r.created_at', 'desc')
      .select(
        'a.uid',
        'a.source',
        'a.external_id',
        'a.title',
        'a.title_en',
        'a.title_ru',
        'a.title_uk',
        'a.episodes',
        'a.score',
        'a.status',
        'a.url',
        'a.image_small',
        'a.image_large',
        'a.synopsis_en',
        'a.synopsis_ru',
        'a.synopsis_uk',
        'a.synopsis_json',
        'a.posters_json',
        'r.anime_uid as list_anime_uid',
        'r.created_at as recommended_at',
        'u.telegram_id',
        'u.username',
        'u.first_name'
      );

    const grouped = new Map();

    for (const row of rows) {
      const resolvedUid = row.uid || row.list_anime_uid;
      if (!resolvedUid) continue;
      if (!grouped.has(resolvedUid)) {
        grouped.set(resolvedUid, {
          uid: resolvedUid,
          source: row.source,
          externalId: row.external_id,
          title: pickTitleByLang(row, user.lang || 'en'),
          titleEn: row.title_en ?? null,
          titleRu: row.title_ru ?? null,
          titleUk: row.title_uk ?? null,
          episodes: row.episodes,
          score: row.score,
          status: row.status,
          url: row.url,
          imageSmall: row.image_small ?? null,
          imageLarge: row.image_large ?? null,
          synopsisEn: row.synopsis_en ?? null,
          synopsisRu: row.synopsis_ru ?? null,
          synopsisUk: row.synopsis_uk ?? null,
          recommendedAt: row.recommended_at,
          recommendCount: 0,
          recommenders: []
        });
      }

      const current = grouped.get(resolvedUid);
      current.recommendCount += 1;

      const recommenderName = row.username || row.first_name || `user_${row.telegram_id}`;
      if (!current.recommenders.includes(recommenderName)) {
        current.recommenders.push(recommenderName);
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => {
        if (b.recommendCount !== a.recommendCount) {
          return b.recommendCount - a.recommendCount;
        }
        return new Date(b.recommendedAt).getTime() - new Date(a.recommendedAt).getTime();
      })
      .slice(0, limit);
  }

  async getWatchStats(telegramId, animeUid) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return { userWatchCount: 0, friendsWatchCount: 0 };
    }

    const canonicalUid = await this.resolveCanonicalUid(animeUid);
    const ownRow = await this.db('user_anime_lists')
      .where({
        user_id: user.id,
        anime_uid: String(canonicalUid),
        list_type: 'watched'
      })
      .first();

    const friendIds = await this.db('friendships')
      .where({ user_id: user.id })
      .pluck('friend_user_id');

    let friendsWatchCount = 0;
    if (friendIds.length) {
      const friendsRow = await this.db('user_anime_lists')
        .whereIn('user_id', friendIds)
        .andWhere({ anime_uid: String(canonicalUid), list_type: 'watched' })
        .sum({ total: 'watch_count' })
        .first();
      friendsWatchCount = Number(friendsRow?.total || 0);
    }

    return {
      userWatchCount: Number(ownRow?.watch_count || 0),
      friendsWatchCount
    };
  }

  async getWatchedWithFriendStats(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const watched = await this.getTrackedList(telegramId, 'watched');
    if (!watched.length) {
      return [];
    }

    const friendIds = await this.db('friendships')
      .where({ user_id: user.id })
      .pluck('friend_user_id');

    const friendsCountByAnime = new Map();

    if (friendIds.length) {
      const rows = await this.db('user_anime_lists')
        .whereIn('user_id', friendIds)
        .andWhere({ list_type: 'watched' })
        .groupBy('anime_uid')
        .select('anime_uid')
        .sum({ total: 'watch_count' });

      for (const row of rows) {
        friendsCountByAnime.set(row.anime_uid, Number(row.total || 0));
      }
    }

    return watched.map((item) => ({
      ...item,
      userWatchCount: Number(item.watchCount || 0),
      friendsWatchCount: friendsCountByAnime.get(item.uid) || 0
    }));
  }

  async getDashboard(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);

    const [watched, planned, favorites, recommendedFromFriends, friends] = await Promise.all([
      this.getWatchedWithFriendStats(telegramId),
      this.getTrackedList(telegramId, 'planned'),
      this.getTrackedList(telegramId, 'favorite'),
      this.getRecommendationsFromFriends(telegramId),
      this.getFriends(telegramId)
    ]);

    return {
      user: user
        ? {
            telegramId: user.telegram_id,
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
            lang: user.lang || null
          }
        : null,
      watched,
      planned,
      favorites,
      recommendedFromFriends,
      friends
    };
  }

  async ensureUserInTransaction(trx, telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.language_code);
    const payload = {
      telegram_id: String(telegramUser.id),
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name ?? null,
      last_name: telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    const mergePayload = {
      username: payload.username,
      first_name: payload.first_name,
      last_name: payload.last_name,
      updated_at: payload.updated_at
    };

    await trx('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    return trx('users').where({ telegram_id: payload.telegram_id }).first();
  }

  async upsertAnimeInTransaction(trx, anime) {
    const normalized = await ensureTitlesI18n(anime);
    const synopsis = buildSynopsisJson(normalized);
    const posters = buildPostersJson(normalized);
    await trx('anime').insert({
      uid: normalized.uid,
      source: normalized.source,
      external_id: normalized.externalId,
      title: normalized.title,
      title_en: normalized.titleEn,
      title_ru: normalized.titleRu,
      title_uk: normalized.titleUk,
      episodes: normalized.episodes,
      score: normalized.score,
      status: normalized.status,
      url: normalized.url,
      image_small: normalized.imageSmall,
      image_large: normalized.imageLarge,
      synopsis_en: normalized.synopsisEn,
      synopsis_ru: normalized.synopsisRu,
      synopsis_uk: normalized.synopsisUk,
      synopsis_json: JSON.stringify(synopsis),
      posters_json: JSON.stringify(posters),
      updated_at: this.db.fn.now()
    }).onConflict('uid').merge({
      source: this.db.raw('excluded.source'),
      external_id: this.db.raw('excluded.external_id'),
      title: this.db.raw('excluded.title'),
      title_en: this.db.raw('excluded.title_en'),
      title_ru: this.db.raw('excluded.title_ru'),
      title_uk: this.db.raw('excluded.title_uk'),
      episodes: this.db.raw('excluded.episodes'),
      score: this.db.raw('excluded.score'),
      status: this.db.raw('excluded.status'),
      url: this.db.raw('excluded.url'),
      image_small: this.db.raw('excluded.image_small'),
      image_large: this.db.raw('excluded.image_large'),
      synopsis_en: this.db.raw('excluded.synopsis_en'),
      synopsis_ru: this.db.raw('excluded.synopsis_ru'),
      synopsis_uk: this.db.raw('excluded.synopsis_uk'),
      synopsis_json: this.db.raw('excluded.synopsis_json'),
      posters_json: this.db.raw('excluded.posters_json'),
      updated_at: this.db.fn.now()
    });
    await this.upsertUidAliases(trx, normalized.uid, [normalized.uid, ...(normalized.legacyUids || [])]);
    await this.upsertTitleIndex(trx, normalized);
  }

  /**
   * Upsert anime record (used for best-effort enrichment).
   * @param {any} animeRaw
   */
  async upsertAnime(animeRaw) {
    const anime = await ensureTitlesI18n(animeRaw);
    const synopsis = buildSynopsisJson(anime);
    const posters = buildPostersJson(anime);
    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: anime.uid,
        source: anime.source,
        external_id: anime.externalId,
        title: anime.title,
        title_en: anime.titleEn,
        title_ru: anime.titleRu,
        title_uk: anime.titleUk,
        episodes: anime.episodes,
        score: anime.score,
        status: anime.status,
        url: anime.url,
        image_small: anime.imageSmall,
        image_large: anime.imageLarge,
        synopsis_en: anime.synopsisEn,
        synopsis_ru: anime.synopsisRu,
        synopsis_uk: anime.synopsisUk,
        synopsis_json: JSON.stringify(synopsis),
        posters_json: JSON.stringify(posters),
        updated_at: this.db.fn.now()
      }).onConflict('uid').merge({
        source: this.db.raw('excluded.source'),
        external_id: this.db.raw('excluded.external_id'),
        title: this.db.raw('excluded.title'),
        title_en: this.db.raw('excluded.title_en'),
        title_ru: this.db.raw('excluded.title_ru'),
        title_uk: this.db.raw('excluded.title_uk'),
        episodes: this.db.raw('excluded.episodes'),
        score: this.db.raw('excluded.score'),
        status: this.db.raw('excluded.status'),
        url: this.db.raw('excluded.url'),
        image_small: this.db.raw('excluded.image_small'),
        image_large: this.db.raw('excluded.image_large'),
        synopsis_en: this.db.raw('excluded.synopsis_en'),
        synopsis_ru: this.db.raw('excluded.synopsis_ru'),
        synopsis_uk: this.db.raw('excluded.synopsis_uk'),
        synopsis_json: this.db.raw('excluded.synopsis_json'),
        posters_json: this.db.raw('excluded.posters_json'),
        updated_at: this.db.fn.now()
      });
      await this.upsertUidAliases(trx, anime.uid, [anime.uid, ...(anime.legacyUids || [])]);
      await this.upsertTitleIndex(trx, anime);
    });
  }
}
