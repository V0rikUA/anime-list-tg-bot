import { safeLang, pickTitleByLang } from './normalizers.js';

export function applyLegacyListMethods(proto) {
  proto.getListByTelegramId = async function(telegramIdRaw, { lang = 'en' } = {}) {
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
  };

  proto.addListItem = async function(telegramIdRaw, { uid, listType } = {}) {
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
  };

  proto.patchListItem = async function(telegramIdRaw, itemIdRaw, { watchCountDelta = null, watchCount = null } = {}) {
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
  };

  proto.deleteListItem = async function(telegramIdRaw, itemIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    const itemId = Number(itemIdRaw);
    if (!telegramId) throw new Error('userId is required');
    if (!Number.isFinite(itemId) || itemId <= 0) throw new Error('invalid itemId');

    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return { ok: false, deleted: false };

    const affected = await this.db('user_anime_lists').where({ id: itemId, user_id: user.id }).del();
    return { ok: true, deleted: affected > 0 };
  };
}
