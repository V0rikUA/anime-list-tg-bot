'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setLanguage, setTheme } from '../lib/store';
import { translate } from '../lib/i18n';
import { useTelegramSafeArea } from '../lib/hooks/useTelegramSafeArea';

/**
 * When running outside Telegram (local dev), you can use debug mode:
 * `/?debug=1&uid=<telegramUserId>`
 *
 * @returns {string|null}
 */
function getDebugUserId() {
  const query = new URLSearchParams(window.location.search);
  const debug = query.get('debug');
  if (debug !== '1') return null;
  const uid = query.get('uid');
  return uid ? String(uid) : null;
}

/**
 * Imperative tab switcher used to avoid pulling additional UI state libs.
 * @param {string} nextTab
 */
function setActiveTab(nextTab) {
  for (const item of document.querySelectorAll('.tab-btn')) {
    item.classList.toggle('active', item.dataset.tab === nextTab);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `tab-${nextTab}`);
  }
}

export default function MiniAppDashboard() {
  useTelegramSafeArea();

  const [mt, setMt] = useState('');
  const withMt = (path) => (mt ? `${path}${path.includes('?') ? '&' : '?'}mt=${encodeURIComponent(mt)}` : path);

  const dispatch = useDispatch();
  const lang = useSelector((s) => s.language.current);
  const theme = useSelector((s) => s.theme?.current || 'auto');
  const t = (key, params) => translate(lang, key, params);

  const [metaText, setMetaText] = useState(t('dashboard.loadingProfile'));
  const [data, setData] = useState(null);
  const [inviteStatus, setInviteStatus] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [searchRaw, setSearchRaw] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState({ loading: false, error: '', items: [], page: 1, pages: 1, total: 0 });
  const [searchToast, setSearchToast] = useState('');

  useEffect(() => {
    // Avoid useSearchParams() to keep static build happy (no Suspense requirement).
    try {
      const q = new URLSearchParams(window.location.search);
      setMt(String(q.get('mt') || '').trim());
    } catch {
      setMt('');
    }
    setMetaText(t('dashboard.loadingProfile'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  function getInitData() {
    try {
      const tg = window.Telegram?.WebApp;
      const initData = typeof tg?.initData === 'string' ? tg.initData.trim() : '';
      return initData || '';
    } catch {
      return '';
    }
  }

  function extractQueryAfterSpace(raw) {
    const s = String(raw || '');
    const idx = s.indexOf(' ');
    if (idx < 0) return '';
    return s.slice(idx + 1).trim();
  }

  function mapTelegramAuthError(code) {
    const c = String(code || '').trim();
    if (!c) return '';
    if (c === 'expired_auth_date') return t('dashboard.searchSessionExpired');
    if (c === 'invalid_hash') return t('dashboard.searchSessionExpired');
    if (c === 'missing_hash') return t('dashboard.searchSessionExpired');
    if (c === 'missing_user_id') return t('dashboard.searchSessionExpired');
    return '';
  }

  async function fetchDashboardSecurely() {
    const tg = window.Telegram?.WebApp;
    const initData = typeof tg?.initData === 'string' ? tg.initData.trim() : '';

    if (initData) {
      const response = await fetch('/api/webapp/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error || t('dashboard.errTelegramValidation'));
      }
      return json;
    }

    const debugUserId = getDebugUserId();
    if (!debugUserId) {
      throw new Error(t('dashboard.errNoInitData'));
    }

    setMetaText(t('dashboard.debugMode', { id: debugUserId }));
    const response = await fetch(`/api/dashboard/${encodeURIComponent(debugUserId)}`);
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.error || t('dashboard.errUserNotFound'));
    }
    return json;
  }

  async function load() {
    const json = await fetchDashboardSecurely();

    const userId = json.telegramUserId;
    const displayName = json.user?.username || json.user?.firstName || `#${userId}`;
    setMetaText(t('dashboard.profileMeta', { name: displayName, id: userId }));
    setData(json);
  }

  useEffect(() => {
    load().catch((error) => {
      console.error(error);
      setMetaText(error.message || t('dashboard.errLoad'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  function onLangChange(e) {
    const next = e.target.value;
    dispatch(setLanguage(next));

    // Best-effort: persist preferred language to backend so titles/search match UI language.
    try {
      const tg = window.Telegram?.WebApp;
      const initData = typeof tg?.initData === 'string' ? tg.initData.trim() : '';
      if (initData) {
        fetch('/api/webapp/lang', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, lang: next })
        }).catch(() => null);
      }
    } catch {
      // ignore
    }
  }

  function onThemeChange(e) {
    dispatch(setTheme(e.target.value));
  }

  async function copyInviteLink() {
    setInviteStatus('');

    const tg = window.Telegram?.WebApp;
    const initData = typeof tg?.initData === 'string' ? tg.initData.trim() : '';
    if (!initData) {
      setInviteStatus(t('dashboard.errNoInitData'));
      return;
    }

    const response = await fetch('/api/webapp/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || t('dashboard.errTelegramValidation'));
    }

    const link = String(json.link || '').trim();
    if (!link) {
      throw new Error('Invite link is empty');
    }

    setInviteLink(link);

    async function copyText(text) {
      // 1) Modern Clipboard API (may be blocked in some WebViews)
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // fall through
      }

      // 2) Legacy execCommand fallback
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', 'true');
        el.style.position = 'fixed';
        el.style.top = '-1000px';
        el.style.left = '-1000px';
        document.body.appendChild(el);
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return Boolean(ok);
      } catch {
        return false;
      }
    }

    const ok = await copyText(link);
    if (ok) {
      setInviteStatus(t('dashboard.inviteCopied'));
      try {
        tg?.HapticFeedback?.notificationOccurred?.('success');
      } catch {
        // ignore
      }
      return;
    }

    // Clipboard can be restricted in some WebViews. Keep the link visible for manual copy.
    setInviteStatus(t('dashboard.inviteCopyFailed'));
    try {
      tg?.HapticFeedback?.notificationOccurred?.('error');
    } catch {
      // ignore
    }
  }

  async function runLiveSearch({ q, page }) {
    const initData = getInitData();
    if (!initData) {
      throw new Error(t('dashboard.errNoInitData'));
    }
    const response = await fetch('/api/webapp/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, q, limit: 5, page })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      const hint = mapTelegramAuthError(json?.error);
      throw new Error(hint || json?.error || json?.detail || t('dashboard.errTelegramValidation'));
    }
    return json;
  }

  async function triggerSearch(qRaw, page = 1) {
    const q = String(qRaw || '').trim();
    if (!q) return;
    setSearchState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const json = await runLiveSearch({ q, page });
      setSearchState({
        loading: false,
        error: '',
        items: Array.isArray(json.items) ? json.items : [],
        page: Number(json.page) || page,
        pages: Number(json.pages) || 1,
        total: Number(json.total) || 0
      });
      setActiveTab('search');
    } catch (e) {
      setSearchState((s) => ({ ...s, loading: false, error: e?.message || t('dashboard.errLoad') }));
    }
  }

  async function addToList(uid, listType) {
    const initData = getInitData();
    if (!initData) throw new Error(t('dashboard.errNoInitData'));
    const response = await fetch('/api/webapp/list/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, uid, listType })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      const hint = mapTelegramAuthError(json?.error);
      throw new Error(hint || json?.error || json?.detail || t('dashboard.errTelegramValidation'));
    }
  }

  async function addRecommendation(uid) {
    const initData = getInitData();
    if (!initData) throw new Error(t('dashboard.errNoInitData'));
    const response = await fetch('/api/webapp/recommend/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, uid })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      const hint = mapTelegramAuthError(json?.error);
      throw new Error(hint || json?.error || json?.detail || t('dashboard.errTelegramValidation'));
    }
  }

  // Live search: call API only when user typed a space and some query after it.
  useEffect(() => {
    const q = extractQueryAfterSpace(searchRaw);
    setSearchQuery(q);
    setSearchToast('');

    if (!q) {
      setSearchState({ loading: false, error: '', items: [], page: 1, pages: 1, total: 0 });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      // Avoid duplicate requests if the user submits manually on Enter.
      setSearchState((s) => ({ ...s, loading: true, error: '' }));
      runLiveSearch({ q, page: 1 })
        .then((json) => {
          if (cancelled) return;
          setSearchState({
            loading: false,
            error: '',
            items: Array.isArray(json.items) ? json.items : [],
            page: Number(json.page) || 1,
            pages: Number(json.pages) || 1,
            total: Number(json.total) || 0
          });
          setActiveTab('search');
        })
        .catch((e) => {
          if (cancelled) return;
          setSearchState((s) => ({ ...s, loading: false, error: e?.message || t('dashboard.errLoad') }));
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRaw, lang]);

  async function searchGoToPage(nextPage) {
    const q = String(searchQuery || '').trim();
    if (!q) return;
    await triggerSearch(q, nextPage);
  }

  function renderAnimeList(list, withWatchStats) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{t('dashboard.empty')}</p>;
    }

    return list.map((item) => (
      <Link className="item-link" href={withMt(`/title/${encodeURIComponent(item.uid)}`)} key={item.uid}>
        <article className="item">
          <div className="item-row">
            {item.imageSmall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={item.imageSmall} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <div className="thumb" />
            )}
            <div>
              <p className="item-title">{item.title}</p>
              <p className="item-sub">{item.uid}</p>
              {withWatchStats ? (
                <p className="item-sub">
                  {t('dashboard.watchStats', { you: item.userWatchCount || 0, friends: item.friendsWatchCount || 0 })}
                </p>
              ) : null}
            </div>
          </div>
        </article>
      </Link>
    ));
  }

  function renderRecommended(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{t('dashboard.empty')}</p>;
    }

    return list.map((item) => (
      <Link className="item-link" href={withMt(`/title/${encodeURIComponent(item.uid)}`)} key={item.uid}>
        <article className="item">
          <div className="item-row">
            {item.imageSmall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={item.imageSmall} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <div className="thumb" />
            )}
            <div>
              <p className="item-title">{item.title}</p>
              <p className="item-sub">
                {t('dashboard.recommendedBy', { names: (item.recommenders || []).join(', ') || t('dashboard.unknown') })}
              </p>
              <span className="badge">x{item.recommendCount || 0}</span>
            </div>
          </div>
        </article>
      </Link>
    ));
  }

  function renderFriends(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{t('dashboard.empty')}</p>;
    }

    return list.map((f) => (
      <article className="item" key={f.telegramId}>
        <p className="item-title">{f.label}</p>
        <p className="item-sub">{t('dashboard.tgId', { id: f.telegramId })}</p>
      </article>
    ));
  }

  const watchedCount = data?.watched?.length || 0;
  const plannedCount = data?.planned?.length || 0;
  const favoritesCount = data?.favorites?.length || 0;
  const friendsCount = data?.friends?.length || 0;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="meta">{metaText}</p>
        </div>
        <div className="actions">
          <select className="select select--sm" value={theme} onChange={onThemeChange} aria-label={t('common.theme')}>
            <option value="auto">{t('common.themeAuto')}</option>
            <option value="dark">{t('common.themeDark')}</option>
            <option value="light">{t('common.themeLight')}</option>
          </select>
          <select className="select select--sm" value={lang} onChange={onLangChange} aria-label={t('common.language')}>
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="uk">UK</option>
          </select>
          <button
            className="btn"
            onClick={() => {
              load().catch((error) => {
                console.error(error);
                setMetaText(error.message || t('dashboard.errRefresh'));
              });
            }}
            type="button"
          >
            {t('dashboard.refresh')}
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="card metric">
          <p className="label">{t('dashboard.watched')}</p>
          <p className="value">{watchedCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{t('dashboard.planned')}</p>
          <p className="value">{plannedCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{t('dashboard.favorites')}</p>
          <p className="value">{favoritesCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{t('dashboard.friends')}</p>
          <p className="value">{friendsCount}</p>
        </article>
      </section>

      <section className="tabs card">
        <div className="tab-head">
          <button className="tab-btn" data-tab="search" onClick={() => setActiveTab('search')} type="button">{t('dashboard.search')}</button>
          <button className="tab-btn active" data-tab="watched" onClick={() => setActiveTab('watched')} type="button">{t('dashboard.watched')}</button>
          <button className="tab-btn" data-tab="planned" onClick={() => setActiveTab('planned')} type="button">{t('dashboard.planned')}</button>
          <button className="tab-btn" data-tab="favorites" onClick={() => setActiveTab('favorites')} type="button">{t('dashboard.favorites')}</button>
          <button className="tab-btn" data-tab="recommended" onClick={() => setActiveTab('recommended')} type="button">{t('dashboard.recommended')}</button>
          <button className="tab-btn" data-tab="friends" onClick={() => setActiveTab('friends')} type="button">{t('dashboard.friends')}</button>
        </div>
        <div className="tab-body">
          <div id="tab-search" className="tab-panel">
            <div className="search-box">
              <p className="meta">{t('dashboard.searchHint')}</p>
              <div className="search-row">
                <input
                  className="search-input"
                  value={searchRaw}
                  onChange={(e) => setSearchRaw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    // Manual submit: allow searching by the current query-after-space,
                    // otherwise fallback to searching by the whole input.
                    const q = String(searchQuery || '').trim() || String(searchRaw || '').trim();
                    triggerSearch(q, 1).catch(() => null);
                  }}
                  placeholder={t('dashboard.searchPlaceholder')}
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
              </div>

              {searchRaw.trim() && !searchQuery ? <p className="meta">{t('dashboard.searchWaitSpace')}</p> : null}
              {searchState.loading ? <p className="meta">{t('dashboard.searchLoading')}</p> : null}
              {searchState.error ? <p className="meta">{searchState.error}</p> : null}
              {searchToast ? <p className="meta">{searchToast}</p> : null}

              {searchQuery && !searchState.loading && (!searchState.items || searchState.items.length === 0) ? (
                <p className="empty">{t('dashboard.searchEmpty')}</p>
              ) : null}

              {(searchState.items || []).map((it) => (
                <article className="item" key={it.uid}>
                  <div className="item-row">
                    {it.imageSmall ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={it.imageSmall} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="thumb" />
                    )}
                    <div>
                      <p className="item-title">{it.title}</p>
                      <p className="item-sub">{it.uid}</p>
                      <div className="search-actions">
                        <button
                          className="btn-chip"
                          type="button"
                          onClick={() => {
                            setSearchToast('');
                            addToList(it.uid, 'planned')
                              .then(() => {
                                setSearchToast(t('dashboard.added'));
                                load().catch(() => null);
                              })
                              .catch((e) => setSearchToast(e?.message || t('dashboard.addFailed')));
                          }}
                        >
                          {t('dashboard.addPlanned')}
                        </button>
                        <button
                          className="btn-chip"
                          type="button"
                          onClick={() => {
                            setSearchToast('');
                            addToList(it.uid, 'favorite')
                              .then(() => {
                                setSearchToast(t('dashboard.added'));
                                load().catch(() => null);
                              })
                              .catch((e) => setSearchToast(e?.message || t('dashboard.addFailed')));
                          }}
                        >
                          {t('dashboard.addFavorite')}
                        </button>
                        <button
                          className="btn-chip"
                          type="button"
                          onClick={() => {
                            setSearchToast('');
                            addRecommendation(it.uid)
                              .then(() => {
                                setSearchToast(t('dashboard.added'));
                                load().catch(() => null);
                              })
                              .catch((e) => setSearchToast(e?.message || t('dashboard.addFailed')));
                          }}
                        >
                          {t('dashboard.addRecommend')}
                        </button>
                        <Link className="btn-chip" href={withMt(`/title/${encodeURIComponent(it.uid)}`)}>
                          {t('title.open')}
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {searchState.pages > 1 ? (
                <div className="search-pager">
                  <button className="btn-chip" type="button" disabled={searchState.loading || searchState.page <= 1} onClick={() => searchGoToPage(Math.max(1, (searchState.page || 1) - 1))}>
                    {t('dashboard.searchPrev')}
                  </button>
                  <p className="meta">{searchState.page}/{searchState.pages}</p>
                  <button className="btn-chip" type="button" disabled={searchState.loading || searchState.page >= searchState.pages} onClick={() => searchGoToPage((searchState.page || 1) + 1)}>
                    {t('dashboard.searchNext')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div id="tab-watched" className="tab-panel active">{renderAnimeList(data?.watched, true)}</div>
          <div id="tab-planned" className="tab-panel">{renderAnimeList(data?.planned, false)}</div>
          <div id="tab-favorites" className="tab-panel">{renderAnimeList(data?.favorites, false)}</div>
          <div id="tab-recommended" className="tab-panel">{renderRecommended(data?.recommendedFromFriends)}</div>
          <div id="tab-friends" className="tab-panel">{renderFriends(data?.friends)}</div>
        </div>
      </section>

      <section className="card invite-box">
        <p className="section-title">{t('dashboard.inviteTitle')}</p>
        <p className="meta">{t('dashboard.inviteHint')}</p>
        <div className="invite-actions">
          <button
            className="btn"
            type="button"
            onClick={() => {
              copyInviteLink().catch((error) => {
                console.error(error);
                setInviteStatus(error.message || t('dashboard.inviteCopyFailed'));
              });
            }}
          >
            {t('dashboard.inviteCopy')}
          </button>
          {inviteStatus ? <p className="meta">{inviteStatus}</p> : null}
          {inviteLink ? (
            <p className="meta invite-link">
              <a className="link" href={inviteLink} target="_blank" rel="noreferrer">{inviteLink}</a>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
