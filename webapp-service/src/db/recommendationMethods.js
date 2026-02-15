import { normalizeAnime, mapAnimeRow, pickTitleByLang } from './normalizers.js';

export function applyRecommendationMethods(proto) {
  proto.addRecommendation = async function(telegramUser, anime) {
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
  };

  proto.removeRecommendation = async function(telegramId, uid) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return false;
    }

    const canonicalUid = await this.resolveCanonicalUid(uid);
    const affectedRows = await this.db('user_recommendations')
      .where({ recommender_user_id: user.id, anime_uid: String(canonicalUid) })
      .del();

    return affectedRows > 0;
  };

  proto.getOwnRecommendations = async function(telegramId) {
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
        'r.anime_uid as list_anime_uid',
        'r.created_at as added_at'
      );

    const lang = user.lang || 'en';
    return rows.map((r) => {
      const mapped = mapAnimeRow({ ...r, uid: r.uid || r.list_anime_uid });
      return { ...mapped, title: pickTitleByLang(mapped, lang) };
    });
  };

  proto.getRecommendationsFromFriends = async function(telegramId, limit = 25) {
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
  };
}
