import re
import unicodedata
from typing import Any, Callable, Iterable, List, Optional, Sequence, Tuple


_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """
    Normalize for matching:
    - unicode NFKC
    - case-insensitive (casefold)
    - treat 'ё' as 'е'
    - replace non-alnum with spaces and collapse whitespace
    """
    s = unicodedata.normalize("NFKC", str(text or ""))
    s = s.casefold().replace("ё", "е")
    out_chars: List[str] = []
    for ch in s:
        out_chars.append(ch if ch.isalnum() else " ")
    return _WS_RE.sub(" ", "".join(out_chars)).strip()


def _levenshtein_distance(a: str, b: str) -> int:
    # Classic DP with O(min(len(a), len(b))) memory.
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    if len(a) > len(b):
        a, b = b, a

    prev = list(range(len(a) + 1))
    for j, cb in enumerate(b, start=1):
        cur = [j]
        for i, ca in enumerate(a, start=1):
            ins = cur[i - 1] + 1
            dele = prev[i] + 1
            sub = prev[i - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, dele, sub))
        prev = cur
    return prev[-1]


def _fuzzy_similarity(a: str, b: str) -> float:
    # Returns a number in [0..1].
    if a == b:
        return 1.0
    m = max(len(a), len(b))
    if m <= 0:
        return 1.0
    d = _levenshtein_distance(a, b)
    return max(0.0, 1.0 - (float(d) / float(m)))


def score(query: str, candidate_titles: Sequence[str]) -> float:
    """
    Score query against a list of candidate titles.
    Uses max score across candidates; fuzzy is used only if no exact/prefix/substring matches exist.
    """
    qn = normalize(query)
    if not qn:
        return 0.0

    best_direct = 0.0
    best_fuzzy = 0.0

    for raw in candidate_titles or []:
        cn = normalize(raw)
        if not cn:
            continue

        if cn == qn:
            best_direct = max(best_direct, 1000.0)
            continue

        if cn.startswith(qn):
            # Small bonus: shorter candidate is usually closer to canonical.
            bonus = (len(qn) / max(1, len(cn))) * 10.0
            best_direct = max(best_direct, 800.0 + bonus)
            continue

        if qn in cn:
            bonus = (len(qn) / max(1, len(cn))) * 10.0
            best_direct = max(best_direct, 600.0 + bonus)
            continue

        sim = _fuzzy_similarity(qn, cn)
        best_fuzzy = max(best_fuzzy, sim * 500.0)

    return best_direct if best_direct > 0.0 else best_fuzzy


def _get_attr(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _extract_candidate_titles(obj: Any) -> List[str]:
    titles: List[str] = []

    # Common single-string attrs across providers/schemas.
    for k in ("title", "name", "russian", "english", "title_ru", "title_en"):
        v = _get_attr(obj, k)
        if isinstance(v, str) and v.strip():
            titles.append(v.strip())

    # Common list attrs across providers/schemas.
    for k in ("synonyms", "aliases", "alt_titles", "alternative_titles"):
        v = _get_attr(obj, k)
        if isinstance(v, (list, tuple)):
            for item in v:
                if isinstance(item, str) and item.strip():
                    titles.append(item.strip())

    # De-dup while preserving order (deterministic).
    seen = set()
    out: List[str] = []
    for t in titles:
        n = normalize(t)
        if not n or n in seen:
            continue
        seen.add(n)
        out.append(t)
    return out


def _extract_url(obj: Any) -> str:
    v = _get_attr(obj, "url")
    return str(v or "").strip()


SOURCE_PRIORITY = {
    # Lower is better. Keep stable for deterministic tie-breaks.
    "animego": 10,
    "animevost": 20,
    "anilibria": 30,
    "aniliberty": 40,
    "jutsu": 50,
}


def rank_results(
    query: str,
    results: Sequence[Any],
    *,
    source: str = "",
    get_titles: Optional[Callable[[Any], Sequence[str]]] = None,
    get_url: Optional[Callable[[Any], str]] = None,
) -> List[Any]:
    """
    Return a new list of results sorted by relevance to query.
    This function does not mutate result objects or nested structures.
    """
    if not results:
        return []

    src = str(source or "").strip().lower()
    src_pri = SOURCE_PRIORITY.get(src, 999)

    titles_fn = get_titles or _extract_candidate_titles
    url_fn = get_url or _extract_url

    scored: List[Tuple[Tuple[float, int, str, str, int], Any]] = []
    for idx, r in enumerate(results):
        candidate_titles = list(titles_fn(r) or [])
        s = score(query, candidate_titles)
        url = str(url_fn(r) or "").strip()
        display_title = str(_get_attr(r, "title") or (candidate_titles[0] if candidate_titles else "") or "").strip()
        scored.append(((-float(s), int(src_pri), url, display_title, int(idx)), r))

    scored.sort(key=lambda x: x[0])
    return [r for _, r in scored]

