import { normalizeLang, translateText } from '../services/translate.js';

export const TRACK_LIST_TYPES = new Set(['watched', 'planned', 'favorite']);
const SUPPORTED_LANGS = new Set(['en', 'ru', 'uk']);

export function normalizeStoredLang(raw) {
  const lang = normalizeLang(raw);
  return SUPPORTED_LANGS.has(lang) ? lang : 'en';
}

/**
 * Normalizes anime payload before persisting into DB.
 * @param {any} item
 * @returns {AnimeRow}
 */
export function normalizeAnime(item) {
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

export function parseJsonField(raw, fallback) {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function buildSynopsisJson(anime) {
  return {
    en: anime?.synopsisEn ?? null,
    ru: anime?.synopsisRu ?? null,
    uk: anime?.synopsisUk ?? null
  };
}

export function buildPostersJson(anime) {
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
export function mapAnimeRow(row) {
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

export function safeFriendName(row) {
  return row.username || row.first_name || `user_${row.telegram_id}`;
}

export function pickTitleByLang(anime, langRaw) {
  const lang = normalizeStoredLang(langRaw);
  const en = String(anime?.titleEn || anime?.title_en || anime?.title || '').trim();
  const ru = String(anime?.titleRu || anime?.title_ru || '').trim();
  const uk = String(anime?.titleUk || anime?.title_uk || '').trim();

  if (lang === 'ru' && ru) return ru;
  if (lang === 'uk' && uk) return uk;
  return en || ru || uk || 'Unknown title';
}

export function parseUidForStub(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const match = uid.match(/^(jikan|shikimori|anilist|mal):(\d+)$/i);
  if (!match) return { uid, source: null, externalId: null };
  return {
    uid,
    source: String(match[1] || '').toLowerCase(),
    externalId: String(match[2] || '').trim() || null
  };
}

export async function ensureTitlesI18n(animeRaw) {
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
