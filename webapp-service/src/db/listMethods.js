import { TRACK_LIST_TYPES, normalizeAnime, mapAnimeRow, pickTitleByLang } from './normalizers.js';

export function applyListMethods(proto) {
  proto.addToTrackedList = async function(telegramUser, listType, anime) {
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
  };

  proto.removeFromTrackedList = async function(telegramId, listType, uid) {
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
  };

  proto.getTrackedList = async function(telegramId, listType) {
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
  };

  proto.getWatchMap = async function(uidRaw) {
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
  };

  proto.setWatchMap = async function(uidRaw, watchSourceRaw, watchUrlRaw, watchTitleRaw = null) {
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
  };

  proto.clearWatchMap = async function(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return { ok: false };
    await this.db('watch_title_map').where({ anime_uid: uid }).del();
    return { ok: true };
  };

  proto.getWatchStats = async function(telegramId, animeUid) {
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
  };

  proto.getWatchedWithFriendStats = async function(telegramId) {
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
  };
}
