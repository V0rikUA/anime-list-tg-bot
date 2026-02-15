import crypto from 'node:crypto';

const JIKAN_ANIME = 'https://api.jikan.moe/v4/anime';
const SHIKIMORI_WEB = String(process.env.SHIKIMORI_BASE_URL || 'https://shikimori.me').replace(/\/+$/, '');
const SHIKIMORI_API = `${SHIKIMORI_WEB}/api`;
const ANILIST_URL = 'https://graphql.anilist.co'; // legacy (for old anilist:<id> links)

const FETCH_TIMEOUT_MS = 8000;
const TRANSLATE_TIMEOUT_MS = 5000;

/**
 * fetch() with an AbortController timeout so external API calls never hang.
 */
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Tiny in-memory cache to reduce translation calls / rate limits.
 * NOTE: Per-process; resets on deploy/restart.
 * @type {Map<string, {value: string, expiresAt: number}>}
 */
const translateCache = new Map();

function decodeEntities(text) {
  const t = String(text || '');
  return t
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function toPlainText(text) {
  let t = String(text || '');
  if (!t.trim()) return '';

  // Keep line breaks, drop other tags.
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\/?[^>]+>/g, '');
  t = decodeEntities(t);

  // Normalize whitespace a bit.
  t = t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

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
  const v = String(raw || '').trim().toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

/**
 * Translate text using an unofficial Google endpoint.
 * Falls back to the input text on failure.
 *
 * @param {string} text
 * @param {unknown | {from?: unknown, to: unknown}} targetLangOrOptions
 * @returns {Promise<string>}
 */
async function translateText(text, targetLangOrOptions) {
  const t = String(text || '').trim();
  if (!t) return '';

  let from = 'auto';
  let to = 'en';

  if (typeof targetLangOrOptions === 'object' && targetLangOrOptions !== null) {
    const opts = targetLangOrOptions;
    const rawFrom = String(opts.from || '').trim().toLowerCase();
    const fromNorm = rawFrom === 'ru' || rawFrom === 'uk' || rawFrom === 'en' ? rawFrom : 'auto';
    from = fromNorm;
    to = normLang(opts.to);
  } else {
    to = normLang(targetLangOrOptions);
  }

  if (from !== 'auto' && from === to) return t;

  const key = `${from}:${to}:${sha1(t)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Unofficial endpoint. If it fails, we fall back to English.
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', from);
  url.searchParams.set('tl', to);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', t);

  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, TRANSLATE_TIMEOUT_MS);
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
 * @returns {{source: 'jikan'|'shikimori'|'anilist'|'mal', id: number, uid: string} | null}
 */
function parseUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  const m = uid.match(/^(jikan|shikimori|anilist|mal):(\d+)$/);
  if (!m) return null;
  return { source: m[1], id: Number(m[2]), uid };
}

/**
 * Fetches detailed anime info from Jikan and estimates seasons count.
 * @param {number} id
 */
async function fetchJikanDetails(id) {
  const res = await fetchWithTimeout(`${JIKAN_ANIME}/${id}/full`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jikan failed: ${res.status}`);
  const json = await res.json();
  const a = json?.data;

  let seasons = 1;
  try {
    const rel = await fetchWithTimeout(`${JIKAN_ANIME}/${id}/relations`, { headers: { Accept: 'application/json' } });
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
    title: a?.title_english || a?.title || a?.title_japanese || `jikan:${id}`,
    titleEn: a?.title_english || a?.title || a?.title_japanese || null,
    episodes: a?.episodes ?? null,
    seasons: Number.isFinite(seasons) ? seasons : null,
    status: a?.status ?? null,
    score: a?.score ?? null,
    url: a?.url ?? null,
    imageSmall: a?.images?.jpg?.image_url || null,
    imageLarge: a?.images?.jpg?.large_image_url || a?.images?.jpg?.image_url || null,
    synopsisEn: toPlainText(a?.synopsis || '')
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

  const res = await fetchWithTimeout(ANILIST_URL, {
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
    synopsisEn: toPlainText(m?.description || '')
  };
}

function shikimoriHeaders() {
  const ua = (process.env.SHIKIMORI_USER_AGENT || '').trim() || 'anime-miniapp-dashboard';
  return { Accept: 'application/json', 'User-Agent': ua };
}

function shikimoriUrl(pathname) {
  return `${SHIKIMORI_API}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

function shikimoriAnimeLink(id) {
  return `${SHIKIMORI_WEB}/animes/${id}`;
}

async function fetchShikimoriDetails(id) {
  const res = await fetchWithTimeout(shikimoriUrl(`/animes/${id}`), { headers: shikimoriHeaders() });
  if (!res.ok) throw new Error(`Shikimori failed: ${res.status}`);
  const a = await res.json().catch(() => null);

  const titleEn = String(a?.name || '').trim(); // Shikimori: `name`
  const titleRu = String(a?.russian || '').trim(); // Shikimori: `russian`
  const title = titleEn || titleRu || `shikimori:${id}`;

  return {
    source: 'shikimori',
    externalId: String(id),
    title,
    titleEn: titleEn || null,
    titleRu: titleRu || null,
    episodes: a?.episodes ?? null,
    seasons: null,
    status: a?.status ?? null,
    score: a?.score ? Number(a.score) : null,
    url: shikimoriAnimeLink(id),
    imageSmall: a?.image?.preview ? `${SHIKIMORI_WEB}${a.image.preview}` : null,
    imageLarge: a?.image?.original ? `${SHIKIMORI_WEB}${a.image.original}` : null,
    synopsisRu: toPlainText(a?.description || '')
  };
}

function pickText(...values) {
  for (const value of values) {
    const v = String(value || '').trim();
    if (v) return v;
  }
  return '';
}

function pickNum(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mergeCanonicalMal(id, jikan, shikimori) {
  return {
    source: shikimori ? 'shikimori' : 'jikan',
    externalId: String(id),
    title: pickText(shikimori?.titleRu, jikan?.titleEn, shikimori?.title, jikan?.title, `mal:${id}`),
    titleEn: pickText(jikan?.titleEn, jikan?.title, shikimori?.titleEn, shikimori?.title) || null,
    titleRu: pickText(shikimori?.titleRu, shikimori?.title) || null,
    episodes: pickNum(shikimori?.episodes, jikan?.episodes),
    seasons: pickNum(shikimori?.seasons, jikan?.seasons),
    status: pickText(shikimori?.status, jikan?.status) || null,
    score: pickNum(shikimori?.score, jikan?.score),
    url: pickText(shikimori?.url, jikan?.url) || null,
    imageSmall: pickText(shikimori?.imageSmall, jikan?.imageSmall) || null,
    imageLarge: pickText(shikimori?.imageLarge, jikan?.imageLarge, shikimori?.imageSmall, jikan?.imageSmall) || null,
    synopsisEn: pickText(jikan?.synopsisEn) || null,
    synopsisRu: pickText(shikimori?.synopsisRu) || null
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseUid(searchParams.get('uid'));
  const lang = normLang(searchParams.get('lang'));

  if (!parsed) {
    return Response.json({ ok: false, error: 'uid is required (jikan:<id>, shikimori:<id>, anilist:<id>, mal:<id>)' }, { status: 400 });
  }

  try {
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
        throw new Error('title not found');
      }
      details = mergeCanonicalMal(parsed.id, jikan, shikimori);
    }

    const titleEn = String(details.titleEn || details.title || '').trim();
    const titleRu = String(details.titleRu || '').trim()
      || (titleEn ? await translateText(titleEn, { from: 'en', to: 'ru' }).catch(() => '') : '');
    const titleUk = String(details.titleUk || '').trim()
      || (
        titleRu
          ? await translateText(titleRu, { from: 'ru', to: 'uk' }).catch(() => '')
          : (titleEn ? await translateText(titleEn, { from: 'en', to: 'uk' }).catch(() => '') : '')
      );
    const title = lang === 'ru' ? (titleRu || titleEn) : (lang === 'uk' ? (titleUk || titleEn) : titleEn);

    const synopsisEnRaw = String(details.synopsisEn || '').trim();
    const synopsisRuRaw = String(details.synopsisRu || '').trim();
    const synopsisUkRaw = String(details.synopsisUk || '').trim();

    const [synopsisEn, synopsisRu, synopsisUk] = await Promise.all([
      synopsisEnRaw
        ? Promise.resolve(synopsisEnRaw)
        : (synopsisRuRaw ? translateText(synopsisRuRaw, { from: 'ru', to: 'en' }).catch(() => '') : Promise.resolve('')),
      synopsisRuRaw
        ? Promise.resolve(synopsisRuRaw)
        : (synopsisEnRaw ? translateText(synopsisEnRaw, { from: 'en', to: 'ru' }).catch(() => '') : Promise.resolve('')),
      synopsisUkRaw
        ? Promise.resolve(synopsisUkRaw)
        : (
          synopsisRuRaw
            ? translateText(synopsisRuRaw, { from: 'ru', to: 'uk' }).catch(() => '')
            : (synopsisEnRaw ? translateText(synopsisEnRaw, { from: 'en', to: 'uk' }).catch(() => '') : Promise.resolve(''))
        )
    ]);

    const synopsis = lang === 'ru'
      ? (synopsisRu || synopsisEn || '')
      : (lang === 'uk' ? (synopsisUk || synopsisRu || synopsisEn || '') : (synopsisEn || synopsisRu || ''));

    return Response.json({
      ok: true,
      uid: parsed.uid,
      lang,
      ...details,
      title,
      titleEn: titleEn || null,
      titleRu: titleRu || null,
      titleUk: titleUk || null,
      synopsisEn: synopsisEn || null,
      synopsisRu: synopsisRu || null,
      synopsisUk: synopsisUk || null,
      synopsis
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error?.message || String(error) },
      { status: 502 }
    );
  }
}
