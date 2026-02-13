import crypto from 'node:crypto';

const TRACK_LIST_TYPES = new Set(['watched', 'planned', 'favorite']);
const SUPPORTED_LANGS = new Set(['en', 'ru', 'uk']);

function safeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return SUPPORTED_LANGS.has(v) ? v : 'en';
}

function normalizeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

function pickTitleByLang(row, langRaw) {
  const lang = safeLang(langRaw);
  const en = String(row?.title_en || row?.titleEn || row?.title || '').trim();
  const ru = String(row?.title_ru || row?.titleRu || '').trim();
  const uk = String(row?.title_uk || row?.titleUk || '').trim();

  if (lang === 'ru' && ru) return ru;
  if (lang === 'uk' && uk) return uk;
  return en || ru || uk || 'Unknown title';
}

function toOptionalString(raw) {
  const value = String(raw ?? '').trim();
  return value || null;
}

function toEpisodeNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function safeFriendName(row) {
  return row.username || row.first_name || `user_${row.telegram_id}`;
}

function mapAnimeRow(row) {
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
    addedAt: row.added_at || null,
    watchCount: row.watch_count ?? 0
  };
}

function normalizeAnimePayload(item) {
  const titleFallback = String(item?.title || '').trim();
  const titleEn = String(item?.titleEn ?? '').trim() || titleFallback;

  return {
    uid: String(item.uid),
    source: item.source || null,
    external_id: item.externalId === undefined || item.externalId === null ? null : String(item.externalId),
    title: titleEn || String(item?.titleRu ?? '').trim() || titleFallback || 'Unknown title',
    title_en: titleEn || null,
    title_ru: String(item?.titleRu ?? '').trim() || null,
    title_uk: String(item?.titleUk ?? '').trim() || null,
    episodes: item.episodes ?? null,
    score: item.score ?? null,
    status: item.status ?? null,
    url: item.url ?? null,
    image_small: item.imageSmall ?? null,
    image_large: item.imageLarge ?? null,
    synopsis_en: String(item?.synopsisEn ?? '').trim() || null,
    synopsis_ru: String(item?.synopsisRu ?? '').trim() || null,
    synopsis_uk: String(item?.synopsisUk ?? '').trim() || null,
    legacy_uids: Array.isArray(item?.legacyUids)
      ? item.legacyUids.map((uid) => String(uid || '').trim()).filter(Boolean)
      : []
  };
}

export class ListRepository {
  constructor(db) {
    this.db = db;
    this._hasAliasTable = null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async hasAliasTable() {
    if (this._hasAliasTable !== null) return this._hasAliasTable;
    try {
      this._hasAliasTable = await this.db.schema.hasTable('anime_uid_aliases');
    } catch {
      this._hasAliasTable = false;
    }
    return this._hasAliasTable;
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

  async _ensureUserByTelegramId(db, telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');

    await db('users').insert({
      telegram_id: telegramId,
      updated_at: db.fn.now()
    }).onConflict('telegram_id').merge({ updated_at: db.fn.now() });

    return db('users').where({ telegram_id: telegramId }).first();
  }

  async _upsertAnimeRow(trx, anime) {
    const row = normalizeAnimePayload(anime);
    const uid = await this.resolveCanonicalUid(row.uid);
    row.uid = uid;

    await trx('anime').insert({
      ...row,
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
      updated_at: this.db.fn.now()
    });

    const legacyUids = row.legacy_uids || [];
    if (legacyUids.length) {
      await this.upsertUidAliases(trx, uid, [uid, ...legacyUids]);
    }

    return uid;
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async checkHealth() {
    try {
      await this.db.raw('select 1 as ok');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  async ensureUserByTelegramId(telegramIdRaw) {
    return this._ensureUserByTelegramId(this.db, telegramIdRaw);
  }

  async getUserByTelegramId(telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) return null;
    return this.db('users').where({ telegram_id: telegramId }).first();
  }

  async ensureUser(telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.languageCode || telegramUser?.language_code);
    const telegramId = String(telegramUser?.telegramId || telegramUser?.id || '').trim();
    if (!telegramId) throw new Error('telegramId is required');

    const payload = {
      telegram_id: telegramId,
      username: telegramUser.username ?? null,
      first_name: telegramUser.firstName ?? telegramUser.first_name ?? null,
      last_name: telegramUser.lastName ?? telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    const mergePayload = {
      username: payload.username,
      first_name: payload.first_name,
      last_name: payload.last_name,
      updated_at: payload.updated_at
    };

    await this.db('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    const user = await this.db('users').where({ telegram_id: telegramId }).first();

    if (user && !user.lang && guessedLang) {
      await this.db('users')
        .where({ telegram_id: telegramId })
        .update({ lang: guessedLang, updated_at: this.db.fn.now() });
      return this.db('users').where({ telegram_id: telegramId }).first();
    }

    return user;
  }

  async setUserLang(telegramIdRaw, langRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    const lang = safeLang(langRaw);
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return { ok: false, reason: 'user_not_found' };
    }

    await this.db('users')
      .where({ telegram_id: telegramId })
      .update({ lang, updated_at: this.db.fn.now() });

    return { ok: true, lang };
  }

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  async upsertCatalog(items) {
    if (!Array.isArray(items) || !items.length) return;

    await this.db.transaction(async (trx) => {
      const rows = items.map((item) => {
        const row = normalizeAnimePayload(item);
        return {
          uid: row.uid,
          source: row.source,
          external_id: row.external_id,
          title: row.title,
          title_en: row.title_en,
          title_ru: row.title_ru,
          title_uk: row.title_uk,
          episodes: row.episodes,
          score: row.score,
          status: row.status,
          url: row.url,
          image_small: row.image_small,
          image_large: row.image_large,
          synopsis_en: row.synopsis_en,
          synopsis_ru: row.synopsis_ru,
          synopsis_uk: row.synopsis_uk,
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
        updated_at: this.db.fn.now()
      });

      for (const item of items) {
        const normalized = normalizeAnimePayload(item);
        if (normalized.legacy_uids.length) {
          // eslint-disable-next-line no-await-in-loop
          await this.upsertUidAliases(
            trx,
            normalized.uid,
            [normalized.uid, ...normalized.legacy_uids]
          );
        }
      }
    });
  }

  async getCatalogItem(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return null;
    const row = await this.db('anime').where({ uid }).first();
    return row ? mapAnimeRow(row) : null;
  }

  async getCatalogItemLocalized(uidRaw, lang) {
    const item = await this.getCatalogItem(uidRaw);
    if (!item) return null;
    return { ...item, title: pickTitleByLang(item, lang) };
  }

  // ---------------------------------------------------------------------------
  // Tracked Lists
  // ---------------------------------------------------------------------------

  async addToTrackedList(telegramIdRaw, listType, anime) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');
    if (!TRACK_LIST_TYPES.has(listType)) throw new Error(`Unsupported list type: ${listType}`);

    await this.db.transaction(async (trx) => {
      const user = await this._ensureUserByTelegramId(trx, telegramId);
      const animeUid = await this._upsertAnimeRow(trx, anime);

      if (listType === 'watched') {
        await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: animeUid, list_type: 'planned' })
          .del();

        const existing = await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: animeUid, list_type: 'watched' })
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
            anime_uid: animeUid,
            list_type: 'watched',
            watch_count: 1
          });
        }

        return;
      }

      await trx('user_anime_lists').insert({
        user_id: user.id,
        anime_uid: animeUid,
        list_type: listType,
        watch_count: 0
      }).onConflict(['user_id', 'anime_uid', 'list_type']).ignore();
    });
  }

  async removeFromTrackedList(telegramIdRaw, listType, uidRaw) {
    if (!TRACK_LIST_TYPES.has(listType)) throw new Error(`Unsupported list type: ${listType}`);

    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return false;

    const canonicalUid = await this.resolveCanonicalUid(uidRaw);
    const affectedRows = await this.db('user_anime_lists')
      .where({
        user_id: user.id,
        anime_uid: String(canonicalUid),
        list_type: listType
      })
      .del();

    return affectedRows > 0;
  }

  async getTrackedList(telegramIdRaw, listType) {
    if (!TRACK_LIST_TYPES.has(listType)) throw new Error(`Unsupported list type: ${listType}`);

    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

    const rows = await this.db('user_anime_lists as l')
      .join('anime as a', 'a.uid', 'l.anime_uid')
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
        'l.added_at',
        'l.watch_count'
      );

    const lang = user.lang || 'en';
    return rows.map((r) => {
      const mapped = mapAnimeRow(r);
      return { ...mapped, title: pickTitleByLang(mapped, lang) };
    });
  }

  async getWatchedWithFriendStats(telegramIdRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

    const watched = await this.getTrackedList(telegramIdRaw, 'watched');
    if (!watched.length) return [];

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

    // Fetch the 5 most recently updated watch progress entries for this user.
    const progressRows = await this.db('user_watch_progress')
      .where({ user_id: user.id })
      .orderBy('updated_at', 'desc')
      .limit(5)
      .select('anime_uid', 'last_episode', 'updated_at');

    const progressByUid = new Map(
      progressRows.map((r) => [String(r.anime_uid), {
        lastEpisode: r.last_episode ?? null,
        progressUpdatedAt: r.updated_at ?? null
      }])
    );

    return watched.map((item) => {
      const progress = progressByUid.get(String(item.uid));
      return {
        ...item,
        userWatchCount: Number(item.watchCount || 0),
        friendsWatchCount: friendsCountByAnime.get(item.uid) || 0,
        lastEpisode: progress?.lastEpisode ?? null,
        progressUpdatedAt: progress?.progressUpdatedAt ?? null
      };
    });
  }

  async getWatchStats(telegramIdRaw, animeUidRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return { userWatchCount: 0, friendsWatchCount: 0 };

    const canonicalUid = await this.resolveCanonicalUid(animeUidRaw);
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

  // ---------------------------------------------------------------------------
  // Friends
  // ---------------------------------------------------------------------------

  async getFriends(telegramIdRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

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

    if (existing?.token) return existing.token;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex');
      try {
        await this.db('friend_invites').insert({
          inviter_user_id: user.id,
          token
        });
        return token;
      } catch {
        const invite = await this.db('friend_invites')
          .where({ inviter_user_id: user.id })
          .first();
        if (invite?.token) return invite.token;
      }
    }

    throw new Error('Failed to generate invite token');
  }

  async addFriendByToken(joinerData, tokenRaw) {
    const token = String(tokenRaw || '').trim();
    if (!token) return { ok: false, reason: 'invalid_token' };

    const telegramId = String(joinerData?.telegramId || joinerData?.id || '').trim();
    if (!telegramId) return { ok: false, reason: 'invalid_user' };

    return this.db.transaction(async (trx) => {
      const joinerPayload = {
        telegram_id: telegramId,
        username: joinerData.username ?? null,
        first_name: joinerData.firstName ?? joinerData.first_name ?? null,
        last_name: joinerData.lastName ?? joinerData.last_name ?? null,
        updated_at: this.db.fn.now()
      };

      await trx('users').insert(joinerPayload).onConflict('telegram_id').merge(joinerPayload);
      const joiner = await trx('users').where({ telegram_id: telegramId }).first();

      const invite = await trx('friend_invites as i')
        .join('users as u', 'u.id', 'i.inviter_user_id')
        .where('i.token', token)
        .select('i.inviter_user_id', 'u.telegram_id', 'u.username', 'u.first_name', 'u.last_name')
        .first();

      if (!invite) return { ok: false, reason: 'invalid_token' };
      if (invite.inviter_user_id === joiner.id) return { ok: false, reason: 'self_friend' };

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

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  async addRecommendation(telegramIdRaw, anime) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');

    await this.db.transaction(async (trx) => {
      const user = await this._ensureUserByTelegramId(trx, telegramId);
      const animeUid = await this._upsertAnimeRow(trx, anime);

      await trx('user_recommendations').insert({
        recommender_user_id: user.id,
        anime_uid: animeUid
      }).onConflict(['recommender_user_id', 'anime_uid']).ignore();
    });
  }

  async removeRecommendation(telegramIdRaw, uidRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return false;

    const canonicalUid = await this.resolveCanonicalUid(uidRaw);
    const affectedRows = await this.db('user_recommendations')
      .where({ recommender_user_id: user.id, anime_uid: String(canonicalUid) })
      .del();

    return affectedRows > 0;
  }

  async getOwnRecommendations(telegramIdRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

    const rows = await this.db('user_recommendations as r')
      .join('anime as a', 'a.uid', 'r.anime_uid')
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
        'r.created_at as added_at'
      );

    const lang = user.lang || 'en';
    return rows.map((r) => {
      const mapped = mapAnimeRow(r);
      return { ...mapped, title: pickTitleByLang(mapped, lang) };
    });
  }

  async getRecommendationsFromFriends(telegramIdRaw, limit = 25) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

    const rows = await this.db('user_recommendations as r')
      .join('anime as a', 'a.uid', 'r.anime_uid')
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
        'r.created_at as recommended_at',
        'u.telegram_id',
        'u.username',
        'u.first_name'
      );

    const grouped = new Map();

    for (const row of rows) {
      if (!grouped.has(row.uid)) {
        grouped.set(row.uid, {
          uid: row.uid,
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

      const current = grouped.get(row.uid);
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

  // ---------------------------------------------------------------------------
  // Watch Map
  // ---------------------------------------------------------------------------

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
    if (!anime) throw new Error('anime_not_found');

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

  // ---------------------------------------------------------------------------
  // Watch Progress (existing)
  // ---------------------------------------------------------------------------

  async upsertWatchProgress(telegramIdRaw, {
    animeUid,
    episodeLabel,
    episodeNumber = null,
    source = null,
    quality = null,
    startedVia
  } = {}) {
    const telegramId = String(telegramIdRaw || '').trim();
    const uid = await this.resolveCanonicalUid(animeUid);
    const lastEpisode = String(episodeLabel || '').trim();
    const startedViaNorm = String(startedVia || '').trim().toLowerCase();

    if (!telegramId) throw new Error('userId is required');
    if (!uid) throw new Error('animeUid is required');
    if (!lastEpisode) throw new Error('episode.label is required');
    if (!['webapp_quality', 'bot_source'].includes(startedViaNorm)) {
      throw new Error('invalid startedVia');
    }

    return this.db.transaction(async (trx) => {
      const user = await this._ensureUserByTelegramId(trx, telegramId);

      const existing = await trx('user_watch_progress')
        .where({ user_id: user.id, anime_uid: uid })
        .first();

      const payload = {
        last_episode: lastEpisode,
        last_episode_number: toEpisodeNumber(episodeNumber),
        last_source: toOptionalString(source),
        last_quality: toOptionalString(quality),
        started_via: startedViaNorm,
        updated_at: trx.fn.now()
      };

      if (existing) {
        await trx('user_watch_progress')
          .where({ id: existing.id, user_id: user.id })
          .update(payload);
      } else {
        await trx('user_watch_progress').insert({
          user_id: user.id,
          anime_uid: uid,
          ...payload,
          first_started_at: trx.fn.now(),
          created_at: trx.fn.now()
        });
      }

      return { uid };
    });
  }

  async getRecentWatchProgress(telegramIdRaw, { limit = 5, lang = 'en' } = {}) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return { user: null, items: [] };

    const safeLimit = Number.isFinite(Number(limit))
      ? Math.min(20, Math.max(1, Math.trunc(Number(limit))))
      : 5;

    const progressRows = await this.db('user_watch_progress')
      .where({ user_id: user.id })
      .orderBy('updated_at', 'desc')
      .limit(safeLimit)
      .select(
        'anime_uid',
        'last_episode',
        'last_episode_number',
        'last_source',
        'last_quality',
        'started_via',
        'first_started_at',
        'updated_at'
      );

    const uids = progressRows.map((row) => String(row.anime_uid || '').trim()).filter(Boolean);
    const animeRows = uids.length
      ? await this.db('anime')
        .whereIn('uid', uids)
        .select(
          'uid',
          'source',
          'external_id',
          'title',
          'title_en',
          'title_ru',
          'title_uk',
          'episodes',
          'score',
          'status',
          'url',
          'image_small',
          'image_large',
          'synopsis_en',
          'synopsis_ru',
          'synopsis_uk'
        )
      : [];

    const animeByUid = new Map(animeRows.map((row) => [String(row.uid), row]));
    const pickedLang = safeLang(lang);

    const items = progressRows.map((progress) => {
      const uid = String(progress.anime_uid);
      const anime = animeByUid.get(uid) || { uid };
      return {
        uid,
        source: anime.source ?? null,
        externalId: anime.external_id ?? null,
        titleEn: anime.title_en ?? null,
        titleRu: anime.title_ru ?? null,
        titleUk: anime.title_uk ?? null,
        title: pickTitleByLang(anime, pickedLang),
        episodes: anime.episodes ?? null,
        score: anime.score ?? null,
        status: anime.status ?? null,
        url: anime.url ?? null,
        imageSmall: anime.image_small ?? null,
        imageLarge: anime.image_large ?? null,
        synopsisEn: anime.synopsis_en ?? null,
        synopsisRu: anime.synopsis_ru ?? null,
        synopsisUk: anime.synopsis_uk ?? null,
        lastEpisode: progress.last_episode ?? null,
        lastEpisodeNumber: progress.last_episode_number !== null && progress.last_episode_number !== undefined
          ? Number(progress.last_episode_number)
          : null,
        lastSource: progress.last_source ?? null,
        lastQuality: progress.last_quality ?? null,
        startedVia: progress.started_via ?? null,
        firstStartedAt: progress.first_started_at ?? null,
        updatedAt: progress.updated_at ?? null
      };
    });

    return {
      user: { telegramId: user.telegram_id },
      items
    };
  }

  async deleteWatchProgress(telegramIdRaw, animeUidRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    const uid = await this.resolveCanonicalUid(animeUidRaw);
    if (!telegramId) throw new Error('userId is required');
    if (!uid) throw new Error('animeUid is required');

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return { ok: false, deleted: false };

    const affected = await this.db('user_watch_progress')
      .where({ user_id: user.id, anime_uid: uid })
      .del();
    return { ok: true, deleted: affected > 0 };
  }

  // ---------------------------------------------------------------------------
  // Existing list endpoints (kept for backward compatibility)
  // ---------------------------------------------------------------------------

  async getListByTelegramId(telegramIdRaw, { lang = 'en' } = {}) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return { user: null, lists: { watched: [], planned: [], favorite: [] } };

    const rows = await this.db('user_anime_lists as l')
      .join('anime as a', 'a.uid', 'l.anime_uid')
      .where({ user_id: user.id })
      .orderBy('l.added_at', 'desc')
      .select(
        'l.id as item_id',
        'l.list_type',
        'l.watch_count',
        'l.added_at',
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
        'a.image_large'
      );

    const out = { watched: [], planned: [], favorite: [] };
    const pickedLang = safeLang(lang);

    for (const r of rows) {
      const listType = String(r.list_type || '').trim().toLowerCase();
      if (!(listType in out)) continue;
      out[listType].push({
        itemId: r.item_id,
        listType,
        uid: r.uid,
        source: r.source ?? null,
        externalId: r.external_id ?? null,
        titleEn: r.title_en ?? null,
        titleRu: r.title_ru ?? null,
        titleUk: r.title_uk ?? null,
        title: pickTitleByLang(r, pickedLang),
        episodes: r.episodes ?? null,
        score: r.score ?? null,
        status: r.status ?? null,
        url: r.url ?? null,
        imageSmall: r.image_small ?? null,
        imageLarge: r.image_large ?? null,
        watchCount: Number(r.watch_count || 0),
        addedAt: r.added_at || null
      });
    }

    return {
      user: { telegramId: user.telegram_id },
      lists: out
    };
  }

  async addListItem(telegramIdRaw, { uid, listType } = {}) {
    const telegramId = String(telegramIdRaw || '').trim();
    const animeUid = await this.resolveCanonicalUid(uid);
    const lt = String(listType || '').trim().toLowerCase();

    if (!telegramId) throw new Error('userId is required');
    if (!animeUid) throw new Error('uid is required');
    if (!['watched', 'planned', 'favorite'].includes(lt)) throw new Error('invalid listType');

    return this.db.transaction(async (trx) => {
      const user = await this._ensureUserByTelegramId(trx, telegramId);

      const anime = await trx('anime').where({ uid: animeUid }).first();
      if (!anime) {
        const err = new Error('anime not found');
        err.status = 404;
        throw err;
      }

      if (lt === 'watched') {
        await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: animeUid, list_type: 'planned' })
          .del();

        const existing = await trx('user_anime_lists')
          .where({ user_id: user.id, anime_uid: animeUid, list_type: 'watched' })
          .first();

        if (existing) {
          await trx('user_anime_lists').where({ id: existing.id }).update({
            watch_count: Number(existing.watch_count || 0) + 1,
            added_at: trx.fn.now()
          });
          return { ok: true, itemId: existing.id };
        }

        const inserted = await trx('user_anime_lists')
          .insert({ user_id: user.id, anime_uid: animeUid, list_type: 'watched', watch_count: 1 })
          .returning(['id'])
          .catch(() => null);

        const id = Array.isArray(inserted) && inserted[0] ? (inserted[0].id ?? inserted[0]) : null;
        return { ok: true, itemId: id };
      }

      const inserted = await trx('user_anime_lists')
        .insert({ user_id: user.id, anime_uid: animeUid, list_type: lt, watch_count: 0 })
        .onConflict(['user_id', 'anime_uid', 'list_type']).ignore()
        .returning(['id'])
        .catch(() => null);

      const id = Array.isArray(inserted) && inserted[0] ? (inserted[0].id ?? inserted[0]) : null;
      return { ok: true, itemId: id };
    });
  }

  async patchListItem(telegramIdRaw, itemIdRaw, { watchCountDelta = null, watchCount = null } = {}) {
    const telegramId = String(telegramIdRaw || '').trim();
    const itemId = Number(itemIdRaw);
    if (!telegramId) throw new Error('userId is required');
    if (!Number.isFinite(itemId) || itemId <= 0) throw new Error('invalid itemId');

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      const err = new Error('user not found');
      err.status = 404;
      throw err;
    }

    const row = await this.db('user_anime_lists').where({ id: itemId, user_id: user.id }).first();
    if (!row) {
      const err = new Error('item not found');
      err.status = 404;
      throw err;
    }

    if (String(row.list_type) !== 'watched') {
      const err = new Error('only watched items can be patched in MVP');
      err.status = 400;
      throw err;
    }

    const patch = {};
    if (watchCount !== null && watchCount !== undefined) {
      const v = Number(watchCount);
      if (!Number.isFinite(v) || v < 0) throw new Error('invalid watchCount');
      patch.watch_count = Math.trunc(v);
    } else if (watchCountDelta !== null && watchCountDelta !== undefined) {
      const d = Number(watchCountDelta);
      if (!Number.isFinite(d)) throw new Error('invalid watchCountDelta');
      patch.watch_count = Math.max(0, Number(row.watch_count || 0) + Math.trunc(d));
    } else {
      const err = new Error('no patch fields provided');
      err.status = 400;
      throw err;
    }

    await this.db('user_anime_lists').where({ id: itemId, user_id: user.id }).update({
      ...patch,
      added_at: this.db.fn.now()
    });

    return { ok: true };
  }

  async deleteListItem(telegramIdRaw, itemIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    const itemId = Number(itemIdRaw);
    if (!telegramId) throw new Error('userId is required');
    if (!Number.isFinite(itemId) || itemId <= 0) throw new Error('invalid itemId');

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return { ok: false, deleted: false };

    const affected = await this.db('user_anime_lists').where({ id: itemId, user_id: user.id }).del();
    return { ok: true, deleted: affected > 0 };
  }
}
