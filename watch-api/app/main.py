import os
import time
import secrets
import importlib
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel


APP_NAME = "watch-api"


def _now() -> float:
    return time.time()


class _Store:
    # Stores Python objects (anicli instances) by opaque ref with TTL.
    def __init__(self, ttl_seconds: int = 3600):
        self._ttl = max(60, int(ttl_seconds))
        self._items: Dict[str, Dict[str, Any]] = {}

    def put(self, kind: str, obj: Any, meta: Optional[dict] = None) -> str:
        ref = secrets.token_hex(16)
        self._items[ref] = {
            "kind": kind,
            "obj": obj,
            "meta": meta or {},
            "expires_at": _now() + self._ttl,
        }
        return ref

    def get(self, ref: str, expected_kind: Optional[str] = None) -> Any:
        item = self._items.get(ref)
        if not item:
            return None
        if _now() > item["expires_at"]:
            self._items.pop(ref, None)
            return None
        if expected_kind and item.get("kind") != expected_kind:
            return None
        return item

    def gc(self) -> None:
        t = _now()
        dead = [k for k, v in self._items.items() if t > v.get("expires_at", 0)]
        for k in dead:
            self._items.pop(k, None)


STORE = _Store(ttl_seconds=int(os.environ.get("WATCH_API_TTL_SEC", "3600") or "3600"))


def _safe_str(v: Any, limit: int = 2000) -> str:
    s = str(v or "").strip()
    if len(s) > limit:
        s = s[:limit]
    return s


def _get_extractor(source: str):
    # anicli_api sources live under anicli_api.source.<name>
    # Each module exports Extractor.
    name = _safe_str(source, 64).lower()
    if not name or any(c for c in name if not (c.isalnum() or c in ("_", "-"))):
        raise ValueError("invalid source")
    mod_name = f"anicli_api.source.{name}"
    mod = importlib.import_module(mod_name)
    Extractor = getattr(mod, "Extractor", None)
    if Extractor is None:
        raise ValueError("Extractor not found")
    return Extractor()


class HealthOut(BaseModel):
    ok: bool = True


class SourceInfo(BaseModel):
    name: str
    note: str = ""


class SourcesOut(BaseModel):
    ok: bool = True
    sources: List[SourceInfo]


class SearchItem(BaseModel):
    source: str
    title: str
    url: str
    thumbnail: Optional[str] = None
    animeRef: str


class SearchOut(BaseModel):
    ok: bool = True
    items: List[SearchItem]


class EpisodeItem(BaseModel):
    num: str
    title: str = ""


class EpisodesOut(BaseModel):
    ok: bool = True
    episodes: List[EpisodeItem]


class WatchSourceItem(BaseModel):
    title: str
    url: str
    sourceRef: str


class SourcesForEpisodeOut(BaseModel):
    ok: bool = True
    sources: List[WatchSourceItem]


class VideoItem(BaseModel):
    type: str = ""
    quality: Optional[int] = None
    url: str
    headers: Dict[str, str] = {}


class VideosOut(BaseModel):
    ok: bool = True
    videos: List[VideoItem]


app = FastAPI(title=APP_NAME)


@app.get("/v1/health", response_model=HealthOut)
async def health():
    STORE.gc()
    return {"ok": True}


@app.get("/v1/sources", response_model=SourcesOut)
async def sources():
    # Static curated list (we still allow calling any installed extractor by name in /search).
    curated = [
        SourceInfo(name="animego", note="Commonly works; may be region-locked."),
        SourceInfo(name="animevost", note="Commonly works; may be region-locked."),
        SourceInfo(name="anilibria", note="May require CIS/Baltic IP."),
        SourceInfo(name="aniliberty", note="May require CIS/Baltic IP."),
        SourceInfo(name="jutsu", note="May require CIS/Baltic IP."),
    ]
    return {"ok": True, "sources": curated}


@app.get("/v1/search", response_model=SearchOut)
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    source: Optional[str] = Query(None, min_length=1, max_length=64),
    limit: int = Query(5, ge=1, le=10),
):
    STORE.gc()
    query = _safe_str(q, 200)
    sources_to_try: List[str]
    if source:
        sources_to_try = [_safe_str(source, 64).lower()]
    else:
        sources_to_try = ["animego", "animevost", "anilibria"]

    items: List[SearchItem] = []
    errors: List[str] = []
    for src in sources_to_try:
        try:
            extractor = _get_extractor(src)
            results = await extractor.a_search(query)  # type: ignore[attr-defined]
            if not results:
                continue
            for r in results[:limit]:
                # Store the search result object so we can resolve anime/episodes later.
                anime_ref = STORE.put("search", r, meta={"source": src})
                items.append(
                    SearchItem(
                        source=src,
                        title=_safe_str(getattr(r, "title", "") or ""),
                        url=_safe_str(getattr(r, "url", "") or "", 4000),
                        thumbnail=_safe_str(getattr(r, "thumbnail", "") or "", 4000) or None,
                        animeRef=anime_ref,
                    )
                )
            if items:
                break
        except Exception as e:  # noqa: BLE001
            errors.append(f"{src}: {type(e).__name__}")
            continue

    if not items and errors:
        raise HTTPException(status_code=502, detail="; ".join(errors))
    return {"ok": True, "items": items}


@app.get("/v1/episodes", response_model=EpisodesOut)
async def episodes(animeRef: str = Query(..., min_length=16, max_length=128)):
    STORE.gc()
    item = STORE.get(animeRef, expected_kind="search")
    if not item:
        raise HTTPException(status_code=404, detail="animeRef not found/expired")

    search_obj = item["obj"]
    try:
        anime = await search_obj.a_get_anime()  # type: ignore[attr-defined]
        eps = await anime.a_get_episodes()  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"failed to fetch episodes: {type(e).__name__}") from e

    out: List[EpisodeItem] = []
    for ep in eps or []:
        num = _safe_str(getattr(ep, "num", "") or getattr(ep, "number", "") or "")
        title = _safe_str(getattr(ep, "title", "") or "")
        if not num:
            continue
        out.append(EpisodeItem(num=num, title=title))

    return {"ok": True, "episodes": out}


@app.get("/v1/sources-for-episode", response_model=SourcesForEpisodeOut)
async def sources_for_episode(
    animeRef: str = Query(..., min_length=16, max_length=128),
    episode_num: str = Query(..., min_length=1, max_length=32),
):
    STORE.gc()
    item = STORE.get(animeRef, expected_kind="search")
    if not item:
        raise HTTPException(status_code=404, detail="animeRef not found/expired")

    search_obj = item["obj"]
    try:
        anime = await search_obj.a_get_anime()  # type: ignore[attr-defined]
        eps = await anime.a_get_episodes()  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"failed to fetch episodes: {type(e).__name__}") from e

    target = None
    for ep in eps or []:
        num = _safe_str(getattr(ep, "num", "") or getattr(ep, "number", "") or "")
        if num == str(episode_num):
            target = ep
            break

    if target is None:
        raise HTTPException(status_code=404, detail="episode not found")

    try:
        srcs = await target.a_get_sources()  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"failed to fetch sources: {type(e).__name__}") from e

    out: List[WatchSourceItem] = []
    for s in srcs or []:
        ref = STORE.put("source", s, meta={"animeRef": animeRef, "episode_num": str(episode_num)})
        out.append(
            WatchSourceItem(
                title=_safe_str(getattr(s, "title", "") or ""),
                url=_safe_str(getattr(s, "url", "") or "", 4000),
                sourceRef=ref,
            )
        )

    return {"ok": True, "sources": out}


@app.get("/v1/videos", response_model=VideosOut)
async def videos(sourceRef: str = Query(..., min_length=16, max_length=128)):
    STORE.gc()
    item = STORE.get(sourceRef, expected_kind="source")
    if not item:
        raise HTTPException(status_code=404, detail="sourceRef not found/expired")

    src_obj = item["obj"]
    try:
        vids = await src_obj.a_get_videos()  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"failed to fetch videos: {type(e).__name__}") from e

    out: List[VideoItem] = []
    for v in vids or []:
        headers = getattr(v, "headers", None) or {}
        if not isinstance(headers, dict):
            headers = {}
        out.append(
            VideoItem(
                type=_safe_str(getattr(v, "type", "") or ""),
                quality=(int(getattr(v, "quality")) if str(getattr(v, "quality", "")).isdigit() else None),
                url=_safe_str(getattr(v, "url", "") or "", 4000),
                headers={str(k): str(val) for k, val in headers.items()},
            )
        )

    return {"ok": True, "videos": out}

