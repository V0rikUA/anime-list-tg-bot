import { safeLang, toOptionalString, toEpisodeNumber, pickTitleByLang } from './normalizers.js';

export function applyProgressMethods(proto) {
  proto.upsertWatchProgress = async function(telegramIdRaw, {
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
  };

  proto.getRecentWatchProgress = async function(telegramIdRaw, { limit = 5, lang = 'en' } = {}) {
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
  };

  proto.deleteWatchProgress = async function(telegramIdRaw, animeUidRaw) {
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
  };
}
