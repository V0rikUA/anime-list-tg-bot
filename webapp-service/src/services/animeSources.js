import { getAnimeById as shikiGetAnimeById, searchAnime as shikiSearchAnime, shikimoriAnimeLink, shikimoriAssetUrl } from './shikimoriClient.js';

const JIKAN_URL = 'https://api.jikan.moe/v4/anime';
const ANILIST_URL = 'https://graphql.anilist.co'; // legacy (kept for existing anilist:<id> rows)

const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

const detailsCache = new Map();

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(cache, key, value, ttlMs = 6 * 60 * 60 * 1000) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Normalized anime shape used across the app.
 * @typedef {Object} AnimeSearchResult
 * @property {string} uid
 * @property {'jikan'|'shikimori'|'anilist'} source
 * @property {string|number} externalId
 * @property {string} title
 * @property {string=} titleEn
 * @property {string=} titleRu
 * @property {string=} titleUk
 * @property {number|null} episodes
 * @property {number|null} score
 * @property {string|null} status
 * @property {string|null} url
 * @property {string|null} imageSmall
 * @property {string|null} imageLarge
 * @property {string|null} synopsisEn
 * @property {string|null=} synopsisRu
 * @property {string|null=} synopsisUk
 * @property {string[]=} legacyUids
 * @property {Record<string, {uid: string, externalId: number|null, url: string|null}>=} sourceRefs
 */

function scoreToNumber(score) {
  if (score === null || score === undefined) {
    return null;
  }
  const num = Number(score);
  return Number.isFinite(num) ? num : null;
}

/**
 * @param {any} item
 * @returns {AnimeSearchResult}
 */
function normalize(item) {
  return {
    uid: item.uid,
    source: item.source,
    externalId: item.externalId,
    title: item.title,
    titleEn: item.titleEn,
    titleRu: item.titleRu,
    titleUk: item.titleUk,
    episodes: item.episodes,
    score: item.score,
    status: item.status,
    url: item.url,
    imageSmall: item.imageSmall ?? null,
    imageLarge: item.imageLarge ?? null,
    synopsisEn: item.synopsisEn ?? null,
    synopsisRu: item.synopsisRu ?? null,
    synopsisUk: item.synopsisUk ?? null,
    legacyUids: Array.isArray(item.legacyUids) ? item.legacyUids : null,
    sourceRefs: item.sourceRefs || null
  };
}

function parseUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const m = uid.match(/^(jikan|shikimori|anilist|mal):(\d+)$/);
  if (!m) return null;
  return { source: m[1], id: Number(m[2]), uid };
}

async function fetchJikanDetails(id) {
  const response = await fetchWithTimeout(`${JIKAN_URL}/${id}/full`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jikan request failed with ${response.status}`);
  const body = await response.json();
  const anime = body?.data;

  return normalize({
    uid: `jikan:${id}`,
    source: 'jikan',
    externalId: id,
    title: anime?.title_english || anime?.title || anime?.title_japanese || 'Unknown title',
    titleEn: anime?.title_english || anime?.title || anime?.title_japanese || null,
    episodes: anime?.episodes ?? null,
    score: scoreToNumber(anime?.score),
    status: anime?.status ?? null,
    url: anime?.url ?? null,
    imageSmall: anime?.images?.jpg?.image_url || null,
    imageLarge: anime?.images?.jpg?.large_image_url || anime?.images?.jpg?.image_url || null,
    synopsisEn: anime?.synopsis || null
  });
}

async function fetchShikimoriDetails(id) {
  const anime = await shikiGetAnimeById(id);

  const titleEn = String(anime?.name || '').trim();
  const titleRu = String(anime?.russian || '').trim();
  const title = titleEn || titleRu || 'Unknown title';

  const score = scoreToNumber(anime?.score);

  return normalize({
    uid: `shikimori:${id}`,
    source: 'shikimori',
    externalId: id,
    title,
    titleEn: titleEn || title,
    titleRu: titleRu || null,
    episodes: anime?.episodes ?? null,
    score,
    status: anime?.status ?? null,
    url: shikimoriAnimeLink(id),
    imageSmall: shikimoriAssetUrl(anime?.image?.preview) || null,
    imageLarge: shikimoriAssetUrl(anime?.image?.original) || null,
    synopsisRu: anime?.description ? String(anime.description) : null
  });
}

async function fetchAniListDetails(id) {
  const graphQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        coverImage { medium large }
        episodes
        averageScore
        description(asHtml: false)
        status
        siteUrl
      }
    }
  `;

  const response = await fetchWithTimeout(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query: graphQuery, variables: { id } })
  });

  if (!response.ok) {
    throw new Error(`AniList request failed with ${response.status}`);
  }

  const body = await response.json();
  const anime = body?.data?.Media;

  return normalize({
    uid: `anilist:${id}`,
    source: 'anilist',
    externalId: id,
    title: anime?.title?.english || anime?.title?.romaji || anime?.title?.native || 'Unknown title',
    titleEn: anime?.title?.english || anime?.title?.romaji || anime?.title?.native || null,
    episodes: anime?.episodes ?? null,
    score: scoreToNumber(anime?.averageScore ? anime.averageScore / 10 : null),
    status: anime?.status ?? null,
    url: anime?.siteUrl ?? null,
    imageSmall: anime?.coverImage?.medium || null,
    imageLarge: anime?.coverImage?.large || anime?.coverImage?.medium || null,
    synopsisEn: anime?.description || null
  });
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<AnimeSearchResult[]>}
 */
async function searchJikan(query, limit) {
  const url = new URL(JIKAN_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sfw', 'true');

  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Jikan request failed with ${response.status}`);
  }

  const body = await response.json();
  const data = Array.isArray(body.data) ? body.data : [];

  return data.map((anime) => normalize({
    uid: `jikan:${anime.mal_id}`,
    source: 'jikan',
    externalId: anime.mal_id,
    title: anime.title_english || anime.title || anime.title_japanese || 'Unknown title',
    titleEn: anime.title_english || anime.title || anime.title_japanese || null,
    episodes: anime.episodes,
    score: scoreToNumber(anime.score),
    status: anime.status,
    url: anime.url,
    imageSmall: anime?.images?.jpg?.image_url || null,
    imageLarge: anime?.images?.jpg?.large_image_url || anime?.images?.jpg?.image_url || null,
    synopsisEn: anime?.synopsis || null
  }));
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<AnimeSearchResult[]>}
 */
async function searchShikimori(query, limit) {
  const items = await shikiSearchAnime({ query, limit });

  return items.map((anime) => {
    const id = Number(anime?.id);
    const titleEn = String(anime?.name || '').trim();
    const titleRu = String(anime?.russian || '').trim();
    const title = titleEn || titleRu || 'Unknown title';
    return normalize({
      uid: `shikimori:${id}`,
      source: 'shikimori',
      externalId: id,
      title,
      titleEn: titleEn || title,
      titleRu: titleRu || null,
      episodes: anime?.episodes ?? null,
      score: scoreToNumber(anime?.score),
      status: anime?.status ?? null,
      url: shikimoriAnimeLink(id),
      imageSmall: shikimoriAssetUrl(anime?.image?.preview) || null,
      imageLarge: shikimoriAssetUrl(anime?.image?.original) || null,
      synopsisRu: anime?.description ? String(anime.description) : null
    });
  });
}

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<AnimeSearchResult[]>}
 */
async function searchAniList(query, limit) {
  const graphQuery = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME) {
          id
          title {
            romaji
            english
          }
          coverImage {
            medium
            large
          }
          episodes
          averageScore
          description(asHtml: false)
          status
          siteUrl
        }
      }
    }
  `;

  const response = await fetchWithTimeout(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query: graphQuery, variables: { search: query, perPage: limit } })
  });

  if (!response.ok) {
    throw new Error(`AniList request failed with ${response.status}`);
  }

  const body = await response.json();
  const media = body?.data?.Page?.media;
  const data = Array.isArray(media) ? media : [];

  return data.map((anime) => normalize({
    uid: `anilist:${anime.id}`,
    source: 'anilist',
    externalId: anime.id,
    title: anime.title?.english || anime.title?.romaji || 'Unknown title',
    titleEn: anime.title?.english || anime.title?.romaji || null,
    episodes: anime.episodes,
    score: scoreToNumber(anime.averageScore ? anime.averageScore / 10 : null),
    status: anime.status,
    url: anime.siteUrl,
    imageSmall: anime?.coverImage?.medium || null,
    imageLarge: anime?.coverImage?.large || anime?.coverImage?.medium || null,
    synopsisEn: anime?.description || null
  }));
}

/**
 * Search anime in multiple sources and return a combined list (sorted by score).
 * @param {string} query
 * @param {number=} limit
 * @returns {Promise<AnimeSearchResult[]>}
 */
export async function searchAnime(query, limit = 5) {
  const tasks = [
    searchJikan(query, limit).catch(() => []),
    searchShikimori(query, limit).catch(() => [])
  ];

  const [jikan, shikimori] = await Promise.all(tasks);
  const combined = [...jikan, ...shikimori];

  combined.sort((a, b) => {
    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    return bScore - aScore;
  });

  return combined;
}

/**
 * Fetch detailed anime info by UID (jikan:<id> or shikimori:<id>).
 * Results are cached in-memory for a few hours.
 *
 * @param {string} uid
 * @returns {Promise<AnimeSearchResult|null>}
 */
export async function fetchAnimeDetails(uid) {
  const parsed = parseUid(uid);
  if (!parsed) return null;

  const cached = cacheGet(detailsCache, parsed.uid);
  if (cached) return cached;

  let details;
  if (parsed.source === 'jikan') {
    details = await fetchJikanDetails(parsed.id);
  } else if (parsed.source === 'shikimori') {
    details = await fetchShikimoriDetails(parsed.id);
  } else if (parsed.source === 'anilist') {
    details = await fetchAniListDetails(parsed.id);
  } else {
    const [jikan, shikimori] = await Promise.all([
      fetchJikanDetails(parsed.id).catch(() => null),
      fetchShikimoriDetails(parsed.id).catch(() => null)
    ]);
    if (!jikan && !shikimori) {
      details = null;
    } else {
      const legacyUids = [shikimori?.uid, jikan?.uid].filter(Boolean);
      details = normalize({
        uid: `mal:${parsed.id}`,
        source: shikimori ? 'shikimori' : 'jikan',
        externalId: parsed.id,
        title: shikimori?.titleRu || jikan?.titleEn || shikimori?.title || jikan?.title || 'Unknown title',
        titleEn: jikan?.titleEn || jikan?.title || shikimori?.titleEn || shikimori?.title || null,
        titleRu: shikimori?.titleRu || null,
        episodes: shikimori?.episodes ?? jikan?.episodes ?? null,
        score: shikimori?.score ?? jikan?.score ?? null,
        status: shikimori?.status ?? jikan?.status ?? null,
        url: shikimori?.url ?? jikan?.url ?? null,
        imageSmall: shikimori?.imageSmall ?? jikan?.imageSmall ?? null,
        imageLarge: shikimori?.imageLarge ?? jikan?.imageLarge ?? null,
        synopsisEn: jikan?.synopsisEn ?? null,
        synopsisRu: shikimori?.synopsisRu ?? null,
        legacyUids,
        sourceRefs: {
          ...(jikan ? { jikan: { uid: jikan.uid, externalId: jikan.externalId, url: jikan.url ?? null } } : null),
          ...(shikimori
            ? { shikimori: { uid: shikimori.uid, externalId: shikimori.externalId, url: shikimori.url ?? null } }
            : null)
        }
      });
    }
  }

  if (details) {
    cacheSet(detailsCache, parsed.uid, details);
  }
  return details;
}
