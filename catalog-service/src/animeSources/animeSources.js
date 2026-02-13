import { searchAnime as shikiSearchAnime, shikimoriAnimeLink, shikimoriAssetUrl } from './shikimoriClient.js';

const JIKAN_URL = 'https://api.jikan.moe/v4/anime';
const ANILIST_URL = 'https://graphql.anilist.co';

function scoreToNumber(score) {
  if (score === null || score === undefined) return null;
  const num = Number(score);
  return Number.isFinite(num) ? num : null;
}

function normalize(item) {
  return {
    uid: String(item.uid),
    source: item.source,
    externalId: item.externalId,
    title: item.title,
    titleEn: item.titleEn ?? null,
    titleRu: item.titleRu ?? null,
    titleUk: item.titleUk ?? null,
    synopsisEn: item.synopsisEn ?? null,
    synopsisRu: item.synopsisRu ?? null,
    synopsisUk: item.synopsisUk ?? null,
    episodes: item.episodes ?? null,
    score: item.score ?? null,
    status: item.status ?? null,
    url: item.url ?? null,
    imageSmall: item.imageSmall ?? null,
    imageLarge: item.imageLarge ?? null
  };
}

async function searchJikan(query, limit) {
  const url = new URL(JIKAN_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sfw', 'true');

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jikan request failed with ${response.status}`);
  const body = await response.json();
  const data = Array.isArray(body?.data) ? body.data : [];

  return data.map((anime) => normalize({
    uid: `jikan:${anime.mal_id}`,
    source: 'jikan',
    externalId: anime.mal_id,
    title: anime.title_english || anime.title || anime.title_japanese || 'Unknown title',
    titleEn: anime.title_english || anime.title || anime.title_japanese || null,
    episodes: anime.episodes ?? null,
    score: scoreToNumber(anime.score),
    status: anime.status ?? null,
    url: anime.url ?? null,
    synopsisEn: anime.synopsis ?? null,
    imageSmall: anime?.images?.jpg?.image_url || null,
    imageLarge: anime?.images?.jpg?.large_image_url || anime?.images?.jpg?.image_url || null
  }));
}

async function searchShikimori(query, limit) {
  const items = await shikiSearchAnime({ query, limit });
  return (items || []).map((anime) => {
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
      synopsisRu: anime?.description ? String(anime.description) : null,
      episodes: anime?.episodes ?? null,
      score: scoreToNumber(anime?.score),
      status: anime?.status ?? null,
      url: shikimoriAnimeLink(id),
      imageSmall: shikimoriAssetUrl(anime?.image?.preview) || null,
      imageLarge: shikimoriAssetUrl(anime?.image?.original) || null
    });
  });
}

async function searchAniList(query, limit) {
  const graphQuery = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME) {
          id
          title { romaji english native }
          coverImage { medium large }
          episodes
          averageScore
          status
          siteUrl
        }
      }
    }
  `;

  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: graphQuery, variables: { search: query, perPage: limit } })
  });

  if (!response.ok) throw new Error(`AniList request failed with ${response.status}`);
  const body = await response.json();
  const data = Array.isArray(body?.data?.Page?.media) ? body.data.Page.media : [];

  return data.map((anime) => normalize({
    uid: `anilist:${anime.id}`,
    source: 'anilist',
    externalId: anime.id,
    title: anime?.title?.english || anime?.title?.romaji || anime?.title?.native || 'Unknown title',
    titleEn: anime?.title?.english || anime?.title?.romaji || anime?.title?.native || null,
    episodes: anime?.episodes ?? null,
    score: scoreToNumber(anime?.averageScore ? anime.averageScore / 10 : null),
    status: anime?.status ?? null,
    url: anime?.siteUrl ?? null,
    imageSmall: anime?.coverImage?.medium || null,
    imageLarge: anime?.coverImage?.large || anime?.coverImage?.medium || null
  }));
}

export async function searchAnimeMultiSource({ query, limit = 10, sources = ['jikan', 'shikimori'] } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const lim = Number(limit);
  const safeLimit = Number.isFinite(lim) ? Math.min(50, Math.max(1, lim)) : 10;
  const srcs = (Array.isArray(sources) ? sources : [])
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);

  const tasks = [];
  if (srcs.includes('jikan')) tasks.push(searchJikan(q, safeLimit).catch(() => []));
  if (srcs.includes('shikimori')) tasks.push(searchShikimori(q, safeLimit).catch(() => []));
  if (srcs.includes('anilist')) tasks.push(searchAniList(q, safeLimit).catch(() => []));

  const parts = await Promise.all(tasks);
  return parts.flat();
}
