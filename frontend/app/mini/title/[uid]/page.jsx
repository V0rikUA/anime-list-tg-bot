'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { setLanguage, setTheme } from '../../../../lib/store';
import { translate } from '../../../../lib/i18n';
import { useTelegramSafeArea } from '../../../../lib/hooks/useTelegramSafeArea';

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

  return (
    <main className="app">
      <header className="topbar">
        <button className="btn" type="button" onClick={() => router.push('/')}>
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
      ) : null}
    </main>
  );
}
