const JIKAN_URL = 'https://api.jikan.moe/v4/anime';
const ANILIST_URL = 'https://graphql.anilist.co';

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
 * @property {'jikan'|'anilist'} source
 * @property {string|number} externalId
 * @property {string} title
 * @property {number|null} episodes
 * @property {number|null} score
 * @property {string|null} status
 * @property {string|null} url
 * @property {string|null} imageSmall
 * @property {string|null} imageLarge
 * @property {string|null} synopsisEn
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
    episodes: item.episodes,
    score: item.score,
    status: item.status,
    url: item.url,
    imageSmall: item.imageSmall ?? null,
    imageLarge: item.imageLarge ?? null,
    synopsisEn: item.synopsisEn ?? null
  };
}

function parseUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const m = uid.match(/^(jikan|anilist):(\d+)$/);
  if (!m) return null;
  return { source: m[1], id: Number(m[2]), uid };
}

async function fetchJikanDetails(id) {
  const response = await fetch(`${JIKAN_URL}/${id}/full`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jikan request failed with ${response.status}`);
  const body = await response.json();
  const anime = body?.data;

  return normalize({
    uid: `jikan:${id}`,
    source: 'jikan',
    externalId: id,
    title: anime?.title || anime?.title_english || anime?.title_japanese || 'Unknown title',
    episodes: anime?.episodes ?? null,
    score: scoreToNumber(anime?.score),
    status: anime?.status ?? null,
    url: anime?.url ?? null,
    imageSmall: anime?.images?.jpg?.image_url || null,
    imageLarge: anime?.images?.jpg?.large_image_url || anime?.images?.jpg?.image_url || null,
    synopsisEn: anime?.synopsis || null
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

  const response = await fetch(ANILIST_URL, {
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

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Jikan request failed with ${response.status}`);
  }

  const body = await response.json();
  const data = Array.isArray(body.data) ? body.data : [];

  return data.map((anime) => normalize({
    uid: `jikan:${anime.mal_id}`,
    source: 'jikan',
    externalId: anime.mal_id,
    title: anime.title,
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

  const response = await fetch(ANILIST_URL, {
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
    searchAniList(query, limit).catch(() => [])
  ];

  const [jikan, anilist] = await Promise.all(tasks);
  const combined = [...jikan, ...anilist];

  combined.sort((a, b) => {
    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    return bScore - aScore;
  });

  return combined;
}

/**
 * Fetch detailed anime info by UID (jikan:<id> or anilist:<id>).
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

  const details = parsed.source === 'jikan'
    ? await fetchJikanDetails(parsed.id)
    : await fetchAniListDetails(parsed.id);

  cacheSet(detailsCache, parsed.uid, details);
  return details;
}
