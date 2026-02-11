import { translateText } from './i18n/translate.js';

const SOURCE_PRIORITY = {
  shikimori: 10,
  jikan: 20,
  anilist: 30
};

function srcPri(source) {
  return SOURCE_PRIORITY[String(source || '').toLowerCase()] ?? 999;
}

function isNil(value) {
  return value === null || value === undefined || value === '';
}

function toSafeText(value) {
  const s = String(value || '').trim();
  return s || null;
}

function toSafeNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMalId(item) {
  const source = String(item?.source || '').toLowerCase();
  if (source !== 'jikan' && source !== 'shikimori') return null;
  const id = toSafeNum(item?.externalId);
  return id && id > 0 ? Math.trunc(id) : null;
}

function orderedUnique(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const v = String(raw || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function pickField(items, ...getters) {
  for (const it of items) {
    for (const get of getters) {
      const value = get(it);
      if (!isNil(value)) return value;
    }
  }
  return null;
}

function pickPrimarySource(items) {
  const ordered = [...items].sort((a, b) => {
    const pa = srcPri(a?.source);
    const pb = srcPri(b?.source);
    if (pa !== pb) return pa - pb;
    return String(a?.uid || '').localeCompare(String(b?.uid || ''));
  });
  const first = ordered[0];
  return String(first?.source || '').toLowerCase() || null;
}

function buildSourceRefs(items) {
  const out = {};
  for (const it of items) {
    const source = String(it?.source || '').toLowerCase();
    if (!source || out[source]) continue;
    out[source] = {
      uid: String(it?.uid || ''),
      externalId: toSafeNum(it?.externalId),
      url: toSafeText(it?.url),
      title: toSafeText(it?.title)
    };
  }
  return out;
}

function mergeGroup(items, canonicalUid, externalId) {
  const ordered = [...items].sort((a, b) => {
    const pa = srcPri(a?.source);
    const pb = srcPri(b?.source);
    if (pa !== pb) return pa - pb;
    return String(a?.uid || '').localeCompare(String(b?.uid || ''));
  });

  const sourceRefs = buildSourceRefs(ordered);
  const primarySource = pickPrimarySource(ordered);

  const sourceOrdered = [...ordered].sort((a, b) => {
    const pa = srcPri(a?.source);
    const pb = srcPri(b?.source);
    if (pa !== pb) return pa - pb;
    return String(a?.uid || '').localeCompare(String(b?.uid || ''));
  });

  const titleEn = toSafeText(
    pickField(
      sourceOrdered.filter((it) => String(it?.source || '').toLowerCase() === 'jikan'),
      (it) => it?.titleEn,
      (it) => it?.title
    )
      ?? pickField(sourceOrdered, (it) => it?.titleEn, (it) => it?.title)
  );

  const titleRu = toSafeText(
    pickField(
      sourceOrdered.filter((it) => String(it?.source || '').toLowerCase() === 'shikimori'),
      (it) => it?.titleRu,
      (it) => it?.title
    )
      ?? pickField(sourceOrdered, (it) => it?.titleRu)
  );

  const synopsisEn = toSafeText(
    pickField(
      sourceOrdered.filter((it) => String(it?.source || '').toLowerCase() === 'jikan'),
      (it) => it?.synopsisEn
    ) ?? pickField(sourceOrdered, (it) => it?.synopsisEn)
  );

  const synopsisRu = toSafeText(
    pickField(
      sourceOrdered.filter((it) => String(it?.source || '').toLowerCase() === 'shikimori'),
      (it) => it?.synopsisRu
    ) ?? pickField(sourceOrdered, (it) => it?.synopsisRu)
  );

  const titleUk = toSafeText(pickField(sourceOrdered, (it) => it?.titleUk));
  const synopsisUk = toSafeText(pickField(sourceOrdered, (it) => it?.synopsisUk));

  const title = titleRu || titleEn || toSafeText(pickField(sourceOrdered, (it) => it?.title)) || 'Unknown title';

  const episodes = toSafeNum(pickField(sourceOrdered, (it) => it?.episodes));
  const score = toSafeNum(pickField(sourceOrdered, (it) => it?.score));
  const status = toSafeText(pickField(sourceOrdered, (it) => it?.status));
  const url = toSafeText(pickField(sourceOrdered, (it) => it?.url));
  const imageSmall = toSafeText(pickField(sourceOrdered, (it) => it?.imageSmall));
  const imageLarge = toSafeText(pickField(sourceOrdered, (it) => it?.imageLarge, (it) => it?.imageSmall));

  const legacyUids = orderedUnique(
    sourceOrdered
      .map((it) => String(it?.uid || '').trim())
      .filter(Boolean)
  );

  return {
    uid: canonicalUid,
    source: primarySource,
    externalId,
    title,
    titleEn,
    titleRu,
    titleUk,
    synopsisEn,
    synopsisRu,
    synopsisUk,
    episodes,
    score,
    status,
    url,
    imageSmall,
    imageLarge,
    legacyUids,
    sourceRefs
  };
}

/**
 * Merge duplicate source items into canonical items.
 *
 * @param {Array<any>} items
 * @returns {Array<any>}
 */
export function mergeCatalogResults(items) {
  const groups = new Map();
  const input = Array.isArray(items) ? items : [];

  input.forEach((item, idx) => {
    const malId = toMalId(item);
    // Canonical identity is MAL-based for jikan/shikimori; everything else stays source-based.
    const key = malId ? `mal:${malId}` : `uid:${String(item?.uid || '') || `idx:${idx}`}`;
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  });

  const out = [];
  const orderedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of orderedKeys) {
    const group = groups.get(key) || [];
    if (!group.length) continue;
    if (key.startsWith('mal:')) {
      const malId = Number(key.slice(4));
      out.push(mergeGroup(group, key, Number.isFinite(malId) ? malId : null));
      continue;
    }

    const single = group[0];
    out.push({
      ...single,
      legacyUids: orderedUnique([String(single?.uid || '').trim()].filter(Boolean)),
      sourceRefs: buildSourceRefs(group),
      synopsisEn: single?.synopsisEn ?? null,
      synopsisRu: single?.synopsisRu ?? null,
      synopsisUk: single?.synopsisUk ?? null
    });
  }

  return out;
}

/**
 * Fill Ukrainian localization using RU->UK fallback to EN->UK.
 *
 * @param {Array<any>} items
 * @returns {Promise<Array<any>>}
 */
export async function localizeUk(items) {
  const input = Array.isArray(items) ? items : [];
  const localized = [];

  for (const item of input) {
    const titleRu = toSafeText(item?.titleRu);
    const titleEn = toSafeText(item?.titleEn);
    const synopsisRu = toSafeText(item?.synopsisRu);
    const synopsisEn = toSafeText(item?.synopsisEn);

    let titleUk = toSafeText(item?.titleUk);
    let synopsisUk = toSafeText(item?.synopsisUk);

    if (!titleUk) {
      // Product rule: UA title from RU first; fallback to EN only when RU is unavailable.
      if (titleRu) titleUk = await translateText(titleRu, { from: 'ru', to: 'uk' });
      else if (titleEn) titleUk = await translateText(titleEn, { from: 'en', to: 'uk' });
    }

    if (!synopsisUk) {
      // Same rule for synopsis: RU->UK primary, EN->UK fallback.
      if (synopsisRu) synopsisUk = await translateText(synopsisRu, { from: 'ru', to: 'uk' });
      else if (synopsisEn) synopsisUk = await translateText(synopsisEn, { from: 'en', to: 'uk' });
    }

    localized.push({
      ...item,
      titleUk: toSafeText(titleUk),
      synopsisUk: toSafeText(synopsisUk)
    });
  }

  return localized;
}
