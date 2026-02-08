import crypto from 'node:crypto';

const JIKAN_ANIME = 'https://api.jikan.moe/v4/anime';
const ANILIST_URL = 'https://graphql.anilist.co';

/**
 * Tiny in-memory cache to reduce translation calls / rate limits.
 * NOTE: Per-process; resets on deploy/restart.
 * @type {Map<string, {value: string, expiresAt: number}>}
 */
const translateCache = new Map();

/** @param {string} key */
function cacheGet(key) {
  const hit = translateCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    translateCache.delete(key);
    return null;
  }
  return hit.value;
}

/**
 * @param {string} key
 * @param {string} value
 * @param {number=} ttlMs
 */
function cacheSet(key, value, ttlMs = 6 * 60 * 60 * 1000) {
  // Tiny cache to reduce rate limits.
  translateCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** @param {string} text */
function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/**
 * Normalize language codes for synopsis translation.
 * @param {unknown} raw
 * @returns {'en'|'ru'|'uk'}
 */
function normLang(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

/**
 * Translate English synopsis to RU/UK using an unofficial Google endpoint.
 * Falls back to the input text on failure.
 *
 * @param {string} text
 * @param {unknown} targetLang
 * @returns {Promise<string>}
 */
async function translateText(text, targetLang) {
  const t = String(text || '').trim();
  if (!t) return '';
  const lang = normLang(targetLang);
  if (lang === 'en') return t;

  const key = `${lang}:${sha1(t)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Unofficial endpoint. If it fails, we fall back to English.
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', lang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', t);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    return t;
  }

  const json = await res.json().catch(() => null);
  const parts = Array.isArray(json?.[0]) ? json[0] : [];
  const out = parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('');
  const translated = out || t;

  cacheSet(key, translated);
  return translated;
}

/**
 * @param {unknown} uidRaw
 * @returns {{source: 'jikan'|'anilist', id: number, uid: string} | null}
 */
function parseUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const m = uid.match(/^(jikan|anilist):(\d+)$/);
  if (!m) return null;
  return { source: m[1], id: Number(m[2]), uid };
}

/**
 * Fetches detailed anime info from Jikan and estimates seasons count.
 * @param {number} id
 */
async function fetchJikanDetails(id) {
  const res = await fetch(`${JIKAN_ANIME}/${id}/full`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jikan failed: ${res.status}`);
  const json = await res.json();
  const a = json?.data;

  let seasons = 1;
  try {
    const rel = await fetch(`${JIKAN_ANIME}/${id}/relations`, { headers: { Accept: 'application/json' } });
    const rj = await rel.json().catch(() => null);
    const rels = Array.isArray(rj?.data) ? rj.data : [];
    let sequelCount = 0;
    for (const r of rels) {
      if (String(r?.relation || '').toLowerCase() !== 'sequel') continue;
      const entries = Array.isArray(r?.entry) ? r.entry : [];
      sequelCount += entries.filter((e) => String(e?.type || '').toLowerCase() === 'anime').length;
    }
    seasons = 1 + sequelCount;
  } catch {
    // ignore
  }

  return {
    source: 'jikan',
    externalId: String(id),
    title: a?.title || a?.title_english || a?.title_japanese || `jikan:${id}`,
    episodes: a?.episodes ?? null,
    seasons: Number.isFinite(seasons) ? seasons : null,
    status: a?.status ?? null,
    score: a?.score ?? null,
    url: a?.url ?? null,
    imageSmall: a?.images?.jpg?.image_url || null,
    imageLarge: a?.images?.jpg?.large_image_url || a?.images?.jpg?.image_url || null,
    synopsisEn: a?.synopsis || null
  };
}

/**
 * Fetches detailed anime info from AniList and estimates seasons count.
 * @param {number} id
 */
async function fetchAniListDetails(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        description(asHtml: false)
        episodes
        averageScore
        status
        siteUrl
        coverImage { medium large }
        relations {
          edges {
            relationType
            node { id type format }
          }
        }
      }
    }
  `;

  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { id } })
  });
  if (!res.ok) throw new Error(`AniList failed: ${res.status}`);
  const json = await res.json();
  const m = json?.data?.Media;

  const edges = Array.isArray(m?.relations?.edges) ? m.relations.edges : [];
  const sequelTv = edges.filter((e) => String(e?.relationType || '') === 'SEQUEL' && String(e?.node?.format || '') === 'TV');
  const seasons = 1 + sequelTv.length;

  return {
    source: 'anilist',
    externalId: String(id),
    title: m?.title?.english || m?.title?.romaji || m?.title?.native || `anilist:${id}`,
    episodes: m?.episodes ?? null,
    seasons: Number.isFinite(seasons) ? seasons : null,
    status: m?.status ?? null,
    score: m?.averageScore ? Number(m.averageScore) / 10 : null,
    url: m?.siteUrl ?? null,
    imageSmall: m?.coverImage?.medium || null,
    imageLarge: m?.coverImage?.large || m?.coverImage?.medium || null,
    synopsisEn: m?.description || null
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseUid(searchParams.get('uid'));
  const lang = normLang(searchParams.get('lang'));

  if (!parsed) {
    return Response.json({ ok: false, error: 'uid is required (jikan:<id> or anilist:<id>)' }, { status: 400 });
  }

  try {
    const details = parsed.source === 'jikan'
      ? await fetchJikanDetails(parsed.id)
      : await fetchAniListDetails(parsed.id);

    const synopsis = details.synopsisEn ? await translateText(details.synopsisEn, lang) : '';

    return Response.json({
      ok: true,
      uid: parsed.uid,
      lang,
      ...details,
      synopsis
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error?.message || String(error) },
      { status: 502 }
    );
  }
}
