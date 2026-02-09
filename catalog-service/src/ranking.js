const WS_RE = /\s+/g;

export function normalize(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .replace(WS_RE, ' ')
    .trim();
  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return String(b || '').length;
  if (!b) return String(a || '').length;

  let s = String(a);
  let t = String(b);
  if (s.length > t.length) {
    const tmp = s;
    s = t;
    t = tmp;
  }

  const prev = new Array(s.length + 1);
  for (let i = 0; i <= s.length; i += 1) prev[i] = i;

  for (let j = 1; j <= t.length; j += 1) {
    const cur = [j];
    const cb = t[j - 1];
    for (let i = 1; i <= s.length; i += 1) {
      const ca = s[i - 1];
      const ins = cur[i - 1] + 1;
      const del = prev[i] + 1;
      const sub = prev[i - 1] + (ca === cb ? 0 : 1);
      cur[i] = Math.min(ins, del, sub);
    }
    for (let i = 0; i < cur.length; i += 1) prev[i] = cur[i];
  }

  return prev[prev.length - 1];
}

function fuzzySimilarity(qn, cn) {
  if (qn === cn) return 1;
  const m = Math.max(qn.length, cn.length);
  if (m <= 0) return 1;
  const d = levenshtein(qn, cn);
  return Math.max(0, 1 - d / m);
}

export function score(query, candidateTitles) {
  const qn = normalize(query);
  if (!qn) return 0;

  let bestDirect = 0;
  let bestFuzzy = 0;

  for (const raw of candidateTitles || []) {
    const cn = normalize(raw);
    if (!cn) continue;

    if (cn === qn) {
      bestDirect = Math.max(bestDirect, 1000);
      continue;
    }
    if (cn.startsWith(qn)) {
      const bonus = (qn.length / Math.max(1, cn.length)) * 10;
      bestDirect = Math.max(bestDirect, 800 + bonus);
      continue;
    }
    if (cn.includes(qn)) {
      const bonus = (qn.length / Math.max(1, cn.length)) * 10;
      bestDirect = Math.max(bestDirect, 600 + bonus);
      continue;
    }
    bestFuzzy = Math.max(bestFuzzy, fuzzySimilarity(qn, cn) * 500);
  }

  return bestDirect > 0 ? bestDirect : bestFuzzy;
}

export const SOURCE_PRIORITY = {
  shikimori: 10,
  jikan: 20,
  anilist: 30
};

export function rankCatalogResults(query, items) {
  const q = String(query || '').trim();
  const srcPri = (src) => SOURCE_PRIORITY[String(src || '').toLowerCase()] ?? 999;

  const scored = (items || []).map((it, idx) => {
    const titles = [
      it?.title,
      it?.titleEn,
      it?.titleRu,
      it?.titleUk
    ].map((t) => String(t || '').trim()).filter(Boolean);

    const s = score(q, titles);
    return { it, idx, s, pri: srcPri(it?.source), uid: String(it?.uid || '') };
  });

  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if (a.pri !== b.pri) return a.pri - b.pri;
    if (a.uid !== b.uid) return a.uid.localeCompare(b.uid);
    return a.idx - b.idx;
  });

  return scored.map((x) => x.it);
}

