function safeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === 'ru' || v === 'uk' || v === 'en' ? v : 'en';
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

export class ListRepository {
  constructor(db) {
    this.db = db;
    this._hasAliasTable = null;
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

  async _ensureUserByTelegramId(db, telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');

    await db('users').insert({
      telegram_id: telegramId,
      updated_at: db.fn.now()
    }).onConflict('telegram_id').merge({ updated_at: db.fn.now() });

    return db('users').where({ telegram_id: telegramId }).first();
  }

  async checkHealth() {
    try {
      await this.db.raw('select 1 as ok');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async ensureUserByTelegramId(telegramIdRaw) {
    return this._ensureUserByTelegramId(this.db, telegramIdRaw);
  }

  async getUserByTelegramId(telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) return null;
    return this.db('users').where({ telegram_id: telegramId }).first();
  }

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
      const anime = await trx('anime').where({ uid }).first();
      if (!anime) {
        const err = new Error('anime not found');
        err.status = 404;
        throw err;
      }

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
}
