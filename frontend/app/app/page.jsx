'use client';

import { useEffect, useMemo, useState } from 'react';

function normLang(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.startsWith('ru')) return 'ru';
  if (v.startsWith('uk')) return 'uk';
  return 'en';
}

const I18N = {
  en: {
    title: 'Anime Dashboard',
    loadingProfile: 'Loading profile...',
    refresh: 'Refresh',
    watched: 'Watched',
    planned: 'Planned',
    favorites: 'Favorites',
    friends: 'Friends',
    recommended: 'Recommended',
    inviteTitle: 'Invite Friend',
    inviteHint1: 'Generate token in bot command:',
    inviteHint2: 'then friend runs',
    empty: 'Empty',
    debugMode: 'Debug mode · User #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'No Telegram initData. Open app from bot or use ?debug=1&uid=<id>.',
    errUserNotFound: 'User not found. Open bot and send /start first.',
    errMissingBackend: 'Missing NEXT_PUBLIC_BACKEND_URL. Set it to your backend base URL.',
    errRefresh: 'Failed to refresh dashboard',
    errLoad: 'Failed to load dashboard'
  },
  ru: {
    title: 'Anime Dashboard',
    loadingProfile: 'Загрузка профиля...',
    refresh: 'Обновить',
    watched: 'Просмотрено',
    planned: 'План',
    favorites: 'Избранное',
    friends: 'Друзья',
    recommended: 'Рекомендовано',
    inviteTitle: 'Пригласить друга',
    inviteHint1: 'Сгенерируй токен в боте командой',
    inviteHint2: 'затем друг пишет',
    empty: 'Пусто',
    debugMode: 'Debug режим · Пользователь #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'Нет Telegram initData. Открой Mini App из бота или используй ?debug=1&uid=<id>.',
    errUserNotFound: 'Пользователь не найден. Открой бота и отправь /start.',
    errMissingBackend: 'Не задан NEXT_PUBLIC_BACKEND_URL. Укажи базовый URL бэкенда.',
    errRefresh: 'Не удалось обновить дашборд',
    errLoad: 'Не удалось загрузить дашборд'
  },
  uk: {
    title: 'Anime Dashboard',
    loadingProfile: 'Завантаження профілю...',
    refresh: 'Оновити',
    watched: 'Переглянуте',
    planned: 'План',
    favorites: 'Обране',
    friends: 'Друзі',
    recommended: 'Рекомендовано',
    inviteTitle: 'Запросити друга',
    inviteHint1: 'Згенеруй токен у боті командою',
    inviteHint2: 'потім друг пише',
    empty: 'Порожньо',
    debugMode: 'Debug режим · Користувач #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'Немає Telegram initData. Відкрий Mini App з бота або використай ?debug=1&uid=<id>.',
    errUserNotFound: 'Користувача не знайдено. Відкрий бота і надішли /start.',
    errMissingBackend: 'Не задано NEXT_PUBLIC_BACKEND_URL. Вкажи базовий URL бекенда.',
    errRefresh: 'Не вдалося оновити дашборд',
    errLoad: 'Не вдалося завантажити дашборд'
  }
};

function tr(lang, key, params) {
  const table = I18N[lang] || I18N.en;
  const template = table[key] || I18N.en[key] || key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function getDebugUserId() {
  const query = new URLSearchParams(window.location.search);
  const debug = query.get('debug');
  if (debug !== '1') return null;
  const uid = query.get('uid');
  return uid ? String(uid) : null;
}

function getPreferredLang(tg) {
  const saved = window.localStorage.getItem('lang');
  if (saved) return normLang(saved);
  const telegramLang = tg?.initDataUnsafe?.user?.language_code;
  return normLang(telegramLang);
}

function setActiveTab(nextTab) {
  for (const item of document.querySelectorAll('.tab-btn')) {
    item.classList.toggle('active', item.dataset.tab === nextTab);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `tab-${nextTab}`);
  }
}

export default function MiniAppDashboard() {
  const [lang, setLang] = useState('en');
  const labels = useMemo(() => I18N[lang] || I18N.en, [lang]);
  const [metaText, setMetaText] = useState(labels.loadingProfile);
  const [data, setData] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    const preferred = getPreferredLang(tg);
    setLang(preferred);
  }, []);

  useEffect(() => {
    setMetaText(labels.loadingProfile);
  }, [labels.loadingProfile]);

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
        throw new Error(json?.error || 'Telegram validation failed');
      }
      return json;
    }

    const debugUserId = getDebugUserId();
    if (!debugUserId) {
      throw new Error(labels.errNoInitData);
    }

    setMetaText(tr(lang, 'debugMode', { id: debugUserId }));
    const response = await fetch(`/api/dashboard/${encodeURIComponent(debugUserId)}`);
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.error || labels.errUserNotFound);
    }
    return json;
  }

  async function load() {
    const json = await fetchDashboardSecurely();

    const userId = json.telegramUserId;
    const displayName = json.user?.username || json.user?.firstName || `#${userId}`;
    setMetaText(tr(lang, 'profileMeta', { name: displayName, id: userId }));
    setData(json);
  }

  useEffect(() => {
    // Load after language is detected to show errors in correct language.
    load().catch((error) => {
      console.error(error);
      setMetaText(error.message || labels.errLoad);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  function onLangChange(e) {
    const next = normLang(e.target.value);
    window.localStorage.setItem('lang', next);
    setLang(next);
  }

  function renderAnimeList(list, withWatchStats) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{labels.empty}</p>;
    }

    return list.map((item) => (
      <article className="item" key={item.uid}>
        <p className="item-title">{item.title}</p>
        <p className="item-sub">{item.uid}</p>
        {withWatchStats ? (
          <p className="item-sub">You: {item.userWatchCount || 0} | Friends: {item.friendsWatchCount || 0}</p>
        ) : null}
      </article>
    ));
  }

  function renderRecommended(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{labels.empty}</p>;
    }

    return list.map((item) => (
      <article className="item" key={item.uid}>
        <p className="item-title">{item.title}</p>
        <p className="item-sub">by: {(item.recommenders || []).join(', ') || 'unknown'}</p>
        <span className="badge">x{item.recommendCount || 0}</span>
      </article>
    ));
  }

  function renderFriends(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return <p className="empty">{labels.empty}</p>;
    }

    return list.map((f) => (
      <article className="item" key={f.telegramId}>
        <p className="item-title">{f.label}</p>
        <p className="item-sub">tg: {f.telegramId}</p>
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
          <h1>{labels.title}</h1>
          <p className="meta">{metaText}</p>
        </div>
        <div className="actions">
          <select className="select" value={lang} onChange={onLangChange} aria-label="Language">
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="uk">UK</option>
          </select>
          <button
            className="btn"
            onClick={() => {
              load().catch((error) => {
                console.error(error);
                setMetaText(error.message || labels.errRefresh);
              });
            }}
            type="button"
          >
            {labels.refresh}
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="card metric">
          <p className="label">{labels.watched}</p>
          <p className="value">{watchedCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{labels.planned}</p>
          <p className="value">{plannedCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{labels.favorites}</p>
          <p className="value">{favoritesCount}</p>
        </article>
        <article className="card metric">
          <p className="label">{labels.friends}</p>
          <p className="value">{friendsCount}</p>
        </article>
      </section>

      <section className="tabs card">
        <div className="tab-head">
          <button className="tab-btn active" data-tab="watched" onClick={() => setActiveTab('watched')} type="button">{labels.watched}</button>
          <button className="tab-btn" data-tab="planned" onClick={() => setActiveTab('planned')} type="button">{labels.planned}</button>
          <button className="tab-btn" data-tab="favorites" onClick={() => setActiveTab('favorites')} type="button">{labels.favorites}</button>
          <button className="tab-btn" data-tab="recommended" onClick={() => setActiveTab('recommended')} type="button">{labels.recommended}</button>
          <button className="tab-btn" data-tab="friends" onClick={() => setActiveTab('friends')} type="button">{labels.friends}</button>
        </div>
        <div className="tab-body">
          <div id="tab-watched" className="tab-panel active">{renderAnimeList(data?.watched, true)}</div>
          <div id="tab-planned" className="tab-panel">{renderAnimeList(data?.planned, false)}</div>
          <div id="tab-favorites" className="tab-panel">{renderAnimeList(data?.favorites, false)}</div>
          <div id="tab-recommended" className="tab-panel">{renderRecommended(data?.recommendedFromFriends)}</div>
          <div id="tab-friends" className="tab-panel">{renderFriends(data?.friends)}</div>
        </div>
      </section>

      <section className="card invite-box">
        <p className="section-title">{labels.inviteTitle}</p>
        <p className="meta">
          {labels.inviteHint1} <code>/invite</code>, {labels.inviteHint2} <code>/join &lt;token&gt;</code>.
        </p>
      </section>
    </main>
  );
}
