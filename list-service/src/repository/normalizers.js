export const TRACK_LIST_TYPES = new Set(['watched', 'planned', 'favorite']);
const SUPPORTED_LANGS = new Set(['en', 'ru', 'uk']);

export function safeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return SUPPORTED_LANGS.has(v) ? v : 'en';
}

export function normalizeLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

export function pickTitleByLang(row, langRaw) {
  const lang = safeLang(langRaw);
  const en = String(row?.title_en || row?.titleEn || row?.title || '').trim();
  const ru = String(row?.title_ru || row?.titleRu || '').trim();
  const uk = String(row?.title_uk || row?.titleUk || '').trim();

  if (lang === 'ru' && ru) return ru;
  if (lang === 'uk' && uk) return uk;
  return en || ru || uk || 'Unknown title';
}

export function toOptionalString(raw) {
  const value = String(raw ?? '').trim();
  return value || null;
}

export function toEpisodeNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function safeFriendName(row) {
  return row.username || row.first_name || `user_${row.telegram_id}`;
}

export function mapAnimeRow(row) {
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

export function normalizeAnimePayload(item) {
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
