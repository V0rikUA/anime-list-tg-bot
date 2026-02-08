'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { setLanguage, setTheme } from '../../../lib/store';
import { translate } from '../../../lib/i18n';
import { useTelegramSafeArea } from '../../../lib/hooks/useTelegramSafeArea';

export default function TitlePage() {
  useTelegramSafeArea();

  const params = useParams();
  const router = useRouter();
  const uid = typeof params?.uid === 'string' ? decodeURIComponent(params.uid) : '';

  const dispatch = useDispatch();
  const lang = useSelector((s) => s.language.current);
  const theme = useSelector((s) => s.theme?.current || 'auto');
  const t = (key, params) => translate(lang, key, params);

  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [watchState, setWatchState] = useState({
    loading: false,
    error: '',
    step: 'idle', // idle | titles | episodes | sources | videos
    animeRef: '',
    episodeNum: '',
    sourceRef: '',
    titles: [],
    episodes: [],
    sources: [],
    videos: []
  });

  const [playerState, setPlayerState] = useState({ open: false, url: '', label: '' });
  const [playerError, setPlayerError] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!uid) return;

    setState({ loading: true, error: '', data: null });
    fetch(`/api/title?uid=${encodeURIComponent(uid)}&lang=${encodeURIComponent(lang)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok || !j?.ok) {
          setState({ loading: false, error: j?.error || t('title.errLoad'), data: null });
          return;
        }
        setState({ loading: false, error: '', data: j });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ loading: false, error: e?.message || String(e), data: null });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, lang]);

  const d = state.data;
  const [mt, setMt] = useState('');

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      setMt(String(q.get('mt') || '').trim());
    } catch {
      setMt('');
    }
  }, []);

  function getInitData() {
    const tg = window.Telegram?.WebApp;
    return typeof tg?.initData === 'string' ? tg.initData.trim() : '';
  }

  function openLink(url) {
    const tg = window.Telegram?.WebApp;
    try {
      if (typeof tg?.openLink === 'function') {
        tg.openLink(url);
        return;
      }
    } catch {
      // ignore
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const canInlinePlay = useMemo(() => {
    return (video) => {
      const url = String(video?.url || '').trim();
      if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return false;

      const type = String(video?.type || '').toLowerCase();
      if (type.includes('m3u8') || type.includes('hls')) return true;
      if (type.includes('mp4')) return true;
      if (url.toLowerCase().includes('.m3u8')) return true;
      if (url.toLowerCase().includes('.mp4')) return true;
      return false;
    };
  }, []);

  useEffect(() => {
    if (!playerState.open) return;
    if (!playerState.url) return;

    let cancelled = false;
    let hls = null;

    const video = videoRef.current;
    if (!video) return;

    setPlayerError('');

    // Reset any previous state.
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // ignore
    }

    const url = String(playerState.url);
    const isHls = url.toLowerCase().includes('.m3u8');

    const onVideoError = () => {
      if (cancelled) return;
      setPlayerError(t('title.watchPlayerFailed'));
    };

    video.addEventListener('error', onVideoError);

    (async () => {
      try {
        if (isHls) {
          const canNative = !!video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl');
          if (canNative) {
            video.src = url;
          } else {
            const mod = await import('hls.js');
            const Hls = mod.default;
            if (!Hls?.isSupported?.()) {
              throw new Error('hls not supported');
            }
            hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false
            });
            hls.on(Hls.Events.ERROR, () => {
              if (cancelled) return;
              setPlayerError(t('title.watchPlayerFailed'));
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          }
        } else {
          video.src = url;
        }

        // Autoplay often works only after a user gesture; our "Play" click counts as one.
        await video.play().catch(() => null);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setPlayerError(t('title.watchPlayerFailed'));
      }
    })();

    return () => {
      cancelled = true;
      video.removeEventListener('error', onVideoError);
      try {
        if (hls?.destroy) hls.destroy();
      } catch {
        // ignore
      }
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.removeAttribute('src');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.open, playerState.url, lang]);

  function closePlayer() {
    setPlayerState({ open: false, url: '', label: '' });
    setPlayerError('');
  }

  function qualityLabel(video) {
    const q = video?.quality;
    if (typeof q === 'number' && Number.isFinite(q) && q > 0) return `${q}p`;
    if (typeof q === 'string' && String(q).trim()) return `${String(q).trim()}p`;
    return t('title.watchAuto');
  }

  async function watchFindTitles() {
    const initData = getInitData();
    if (!initData) {
      setWatchState((s) => ({ ...s, error: t('dashboard.errNoInitData') || 'No initData' }));
      return;
    }

    const q = String(d?.title || '').trim();
    if (!q) return;

    setWatchState((s) => ({ ...s, loading: true, error: '', step: 'idle' }));
    const response = await fetch('/api/webapp/watch/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, q, limit: 5 })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || json?.detail || t('title.watchErr'));
    }

    const items = Array.isArray(json.items) ? json.items : [];
    setWatchState((s) => ({
      ...s,
      loading: false,
      step: 'titles',
      titles: items,
      episodes: [],
      sources: [],
      videos: [],
      animeRef: '',
      episodeNum: '',
      sourceRef: ''
    }));
  }

  async function watchPickTitle(item) {
    const initData = getInitData();
    const animeRef = String(item?.animeRef || '').trim();
    if (!initData || !animeRef) return;

    setWatchState((s) => ({ ...s, loading: true, error: '', animeRef, step: 'titles' }));
    const response = await fetch('/api/webapp/watch/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, animeRef })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || json?.detail || t('title.watchErr'));
    }

    const episodes = Array.isArray(json.episodes) ? json.episodes : [];
    setWatchState((s) => ({
      ...s,
      loading: false,
      step: 'episodes',
      episodes,
      sources: [],
      videos: [],
      episodeNum: '',
      sourceRef: ''
    }));
  }

  async function watchPickEpisode(ep) {
    const initData = getInitData();
    const animeRef = String(watchState.animeRef || '').trim();
    const episodeNum = String(ep?.num || '').trim();
    if (!initData || !animeRef || !episodeNum) return;

    setWatchState((s) => ({ ...s, loading: true, error: '', episodeNum, step: 'episodes' }));
    const response = await fetch('/api/webapp/watch/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, animeRef, episodeNum })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || json?.detail || t('title.watchErr'));
    }

    const sources = Array.isArray(json.sources) ? json.sources : [];
    setWatchState((s) => ({
      ...s,
      loading: false,
      step: 'sources',
      sources,
      videos: [],
      sourceRef: ''
    }));
  }

  async function watchPickSource(src) {
    const initData = getInitData();
    const sourceRef = String(src?.sourceRef || '').trim();
    if (!initData || !sourceRef) return;

    setWatchState((s) => ({ ...s, loading: true, error: '', sourceRef, step: 'sources' }));
    const response = await fetch('/api/webapp/watch/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, sourceRef })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || json?.detail || t('title.watchErr'));
    }

    const videos = Array.isArray(json.videos) ? json.videos : [];
    setWatchState((s) => ({
      ...s,
      loading: false,
      step: 'videos',
      videos
    }));
  }

  return (
    <main className={`app ${playerState.open ? 'has-player' : ''}`}>
      <header className="topbar">
        <button className="btn" type="button" onClick={() => router.push(mt ? `/?mt=${encodeURIComponent(mt)}` : '/')}>
          {t('title.back')}
        </button>
        <div className="actions">
          <select className="select select--sm" value={theme} onChange={(e) => dispatch(setTheme(e.target.value))} aria-label={t('common.theme')}>
            <option value="auto">{t('common.themeAuto')}</option>
            <option value="dark">{t('common.themeDark')}</option>
            <option value="light">{t('common.themeLight')}</option>
          </select>
          <select
            className="select select--sm"
            value={lang}
            onChange={(e) => {
              dispatch(setLanguage(e.target.value));
            }}
            aria-label={t('common.language')}
          >
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="uk">UK</option>
          </select>
        </div>
      </header>

      {state.loading ? (
        <p className="meta">{t('title.loading')}</p>
      ) : state.error ? (
        <p className="meta">{state.error}</p>
      ) : d ? (
        <>
          <section className="card">
            <div className="title-hero">
              {d.imageLarge ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="title-cover" src={d.imageLarge} alt={d.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : null}
              <div className="title-meta">
                <h1 className="title-h1">{d.title}</h1>
                <p className="meta mono">{uid}</p>
                <div className="kv">
                  <div className="kv-row"><span className="kv-k">{t('title.seasons')}:</span> <span className="kv-v">{d.seasons ?? t('common.na')}</span></div>
                  <div className="kv-row"><span className="kv-k">{t('title.episodes')}:</span> <span className="kv-v">{d.episodes ?? t('common.na')}</span></div>
                  <div className="kv-row"><span className="kv-k">{t('title.status')}:</span> <span className="kv-v">{d.status ?? t('common.na')}</span></div>
                  <div className="kv-row"><span className="kv-k">{t('title.score')}:</span> <span className="kv-v">{d.score ?? t('common.na')}</span></div>
                  <div className="kv-row"><span className="kv-k">{t('title.source')}:</span> <span className="kv-v">{d.source}</span></div>
                </div>
                {d.url ? (
                  <p className="meta">
                    <a className="link" href={d.url} target="_blank" rel="noreferrer">
                      {t('title.open')}
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="sep" />
            <p className="synopsis">{d.synopsis ? d.synopsis : t('title.noSynopsis')}</p>
          </section>

          <section className="card">
            <p className="section-title">{t('title.watchTitle')}</p>
            <p className="meta">{t('title.watchHint')}</p>
            <div className="invite-actions">
              <button
                className="btn"
                type="button"
                disabled={watchState.loading}
                onClick={() => {
                  watchFindTitles().catch((e) => {
                    console.error(e);
                    setWatchState((s) => ({ ...s, loading: false, error: e?.message || t('title.watchErr') }));
                  });
                }}
              >
                {t('title.watchFind')}
              </button>

              {watchState.error ? <p className="meta">{watchState.error}</p> : null}

              {watchState.step === 'titles' && watchState.titles?.length ? (
                <>
                  <p className="meta">{t('title.watchPickTitle')}</p>
                  {watchState.titles.map((it, idx) => (
                    <button className="select" key={`${it.source}:${idx}`} type="button" onClick={() => watchPickTitle(it).catch(() => null)}>
                      {it.title || `${it.source}`}
                    </button>
                  ))}
                </>
              ) : null}

              {watchState.step === 'episodes' && watchState.episodes?.length ? (
                <>
                  <p className="meta">{t('title.watchPickEpisode')}</p>
                  {watchState.episodes.map((ep) => (
                    <button className="select" key={ep.num} type="button" onClick={() => watchPickEpisode(ep).catch(() => null)}>
                      {ep.title ? `${ep.num}. ${ep.title}` : ep.num}
                    </button>
                  ))}
                </>
              ) : null}

              {watchState.step === 'sources' && watchState.sources?.length ? (
                <>
                  <p className="meta">{t('title.watchPickSource')}</p>
                  {watchState.sources.map((src, idx) => (
                    <button className="select" key={`${idx}:${src.title}`} type="button" onClick={() => watchPickSource(src).catch(() => null)}>
                      {src.title || t('title.watchOpen')}
                    </button>
                  ))}
                </>
              ) : null}

              {watchState.step === 'videos' && watchState.videos?.length ? (
                <>
                  <p className="meta">{t('title.watchPickQuality')}</p>
                  {watchState.videos.map((v, idx) => (
                    <div className="row" key={`${idx}:${v.url}`}>
                      {canInlinePlay(v) ? (
                        <button
                          className="select"
                          type="button"
                          onClick={() => {
                            setPlayerState({
                              open: true,
                              url: String(v.url || ''),
                              label: qualityLabel(v)
                            });
                          }}
                        >
                          {qualityLabel(v)}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </section>

          {playerState.open ? (
            <section className="player-dock" role="dialog" aria-modal="false" aria-label={t('title.watchPlayerTitle')}>
              <div className="player-dock-inner">
                <div className="player-dock-head">
                  <p className="player-dock-title">
                    {t('title.watchPlayerTitle')}
                    {playerState.label ? ` · ${playerState.label}` : ''}
                  </p>
                  <button className="select select--sm" type="button" onClick={closePlayer}>
                    {t('title.close')}
                  </button>
                </div>

                <div className="player-dock-body">
                  <video ref={videoRef} className="player" controls playsInline />
                  {playerError ? (
                    <>
                      <p className="meta">{playerError}</p>
                      <p className="meta">
                        <a className="link" href={playerState.url} target="_blank" rel="noreferrer">
                          {playerState.url}
                        </a>
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
