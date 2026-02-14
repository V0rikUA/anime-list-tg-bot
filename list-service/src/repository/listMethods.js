import { TRACK_LIST_TYPES, mapAnimeRow, pickTitleByLang } from './normalizers.js';

export function applyListMethods(proto) {
  proto.addToTrackedList = async function(telegramIdRaw, listType, anime) {
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
  };

  proto.removeFromTrackedList = async function(telegramIdRaw, listType, uidRaw) {
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
  };

  proto.getTrackedList = async function(telegramIdRaw, listType) {
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
  };

  proto.getWatchedWithFriendStats = async function(telegramIdRaw) {
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
  };

  proto.getWatchStats = async function(telegramIdRaw, animeUidRaw) {
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
  };
}
