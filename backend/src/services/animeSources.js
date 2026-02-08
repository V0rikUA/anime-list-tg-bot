const JIKAN_URL = 'https://api.jikan.moe/v4/anime';
const ANILIST_URL = 'https://graphql.anilist.co';

function scoreToNumber(score) {
  if (score === null || score === undefined) {
    return null;
  }
  const num = Number(score);
  return Number.isFinite(num) ? num : null;
}

function normalize(item) {
  return {
    uid: item.uid,
    source: item.source,
    externalId: item.externalId,
    title: item.title,
    episodes: item.episodes,
    score: item.score,
    status: item.status,
    url: item.url
  };
}

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
    url: anime.url
  }));
}

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
    url: anime.siteUrl
  }));
}

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
