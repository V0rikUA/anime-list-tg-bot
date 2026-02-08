const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const els = {
  userMeta: document.getElementById('userMeta'),
  watchedCount: document.getElementById('watchedCount'),
  plannedCount: document.getElementById('plannedCount'),
  favoritesCount: document.getElementById('favoritesCount'),
  friendsCount: document.getElementById('friendsCount'),
  labelWatched: document.getElementById('labelWatched'),
  labelPlanned: document.getElementById('labelPlanned'),
  labelFavorites: document.getElementById('labelFavorites'),
  labelFriends: document.getElementById('labelFriends'),
  inviteTitle: document.getElementById('inviteTitle'),
  inviteHint: document.getElementById('inviteHint'),
  langSelect: document.getElementById('langSelect'),
  refreshBtn: document.getElementById('refreshBtn'),
  watched: document.getElementById('tab-watched'),
  planned: document.getElementById('tab-planned'),
  favorites: document.getElementById('tab-favorites'),
  recommended: document.getElementById('tab-recommended'),
  friends: document.getElementById('tab-friends')
};

const I18N = {
  en: {
    refresh: 'Refresh',
    watched: 'Watched',
    planned: 'Planned',
    favorites: 'Favorites',
    friends: 'Friends',
    recommended: 'Recommended',
    inviteTitle: 'Invite Friend',
    inviteHint: 'Generate token in bot command: /invite, then friend runs /join <token>.',
    empty: 'Empty',
    debugMode: 'Debug mode · User #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'No Telegram initData. Open app from bot or use ?debug=1&uid=<id>.',
    errUserNotFound: 'User not found. Open bot and send /start first.',
    errRefresh: 'Failed to refresh dashboard',
    errLoad: 'Failed to load dashboard'
  },
  ru: {
    refresh: 'Обновить',
    watched: 'Просмотрено',
    planned: 'План',
    favorites: 'Избранное',
    friends: 'Друзья',
    recommended: 'Рекомендовано',
    inviteTitle: 'Пригласить друга',
    inviteHint: 'Сгенерируй токен в боте командой /invite, затем друг пишет /join <token>.',
    empty: 'Пусто',
    debugMode: 'Debug режим · Пользователь #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'Нет Telegram initData. Открой Mini App из бота или используй ?debug=1&uid=<id>.',
    errUserNotFound: 'Пользователь не найден. Открой бота и отправь /start.',
    errRefresh: 'Не удалось обновить дашборд',
    errLoad: 'Не удалось загрузить дашборд'
  },
  uk: {
    refresh: 'Оновити',
    watched: 'Переглянуте',
    planned: 'План',
    favorites: 'Обране',
    friends: 'Друзі',
    recommended: 'Рекомендовано',
    inviteTitle: 'Запросити друга',
    inviteHint: 'Згенеруй токен у боті командою /invite, потім друг пише /join <token>.',
    empty: 'Порожньо',
    debugMode: 'Debug режим · Користувач #{id}',
    profileMeta: '@{name} · Telegram ID: {id}',
    errNoInitData: 'Немає Telegram initData. Відкрий Mini App з бота або використай ?debug=1&uid=<id>.',
    errUserNotFound: 'Користувача не знайдено. Відкрий бота і надішли /start.',
    errRefresh: 'Не вдалося оновити дашборд',
    errLoad: 'Не вдалося завантажити дашборд'
  }
};

function normLang(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.startsWith('ru')) return 'ru';
  if (value.startsWith('uk')) return 'uk';
  return 'en';
}

function tr(lang, key, params) {
  const table = I18N[lang] || I18N.en;
  const template = table[key] || I18N.en[key] || key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function getPreferredLang() {
  const saved = window.localStorage.getItem('lang');
  if (saved) return normLang(saved);

  const telegramLang = tg?.initDataUnsafe?.user?.language_code;
  return normLang(telegramLang);
}

let currentLang = getPreferredLang();

function applyLang(lang) {
  currentLang = normLang(lang);
  window.localStorage.setItem('lang', currentLang);

  if (els.langSelect) els.langSelect.value = currentLang;
  if (els.refreshBtn) els.refreshBtn.textContent = tr(currentLang, 'refresh');
  if (els.labelWatched) els.labelWatched.textContent = tr(currentLang, 'watched');
  if (els.labelPlanned) els.labelPlanned.textContent = tr(currentLang, 'planned');
  if (els.labelFavorites) els.labelFavorites.textContent = tr(currentLang, 'favorites');
  if (els.labelFriends) els.labelFriends.textContent = tr(currentLang, 'friends');
  if (els.inviteTitle) els.inviteTitle.textContent = tr(currentLang, 'inviteTitle');
  if (els.inviteHint) {
    els.inviteHint.innerHTML = tr(currentLang, 'inviteHint')
      .replace('/invite', '<code>/invite</code>')
      .replace('/join <token>', '<code>/join &lt;token&gt;</code>');
  }

  for (const btn of document.querySelectorAll('.tab-btn')) {
    const tab = btn.dataset.tab;
    const key = tab === 'recommended' ? 'recommended' : tab;
    btn.textContent = tr(currentLang, key);
  }
}

function getInitData() {
  const initData = tg?.initData;
  return typeof initData === 'string' ? initData.trim() : '';
}

function getDebugUserId() {
  const query = new URLSearchParams(window.location.search);
  const debug = query.get('debug');
  if (debug !== '1') {
    return null;
  }

  const uid = query.get('uid');
  return uid ? String(uid) : null;
}

function setEmpty(container) {
  container.innerHTML = `<p class="empty">${tr(currentLang, 'empty')}</p>`;
}

function renderAnimeList(container, list, withWatchStats = false) {
  if (!Array.isArray(list) || list.length === 0) {
    setEmpty(container);
    return;
  }

  container.innerHTML = list
    .map((item) => {
      const stats = withWatchStats
        ? `<p class="item-sub">You: ${item.userWatchCount || 0} | Friends: ${item.friendsWatchCount || 0}</p>`
        : '';

      return `
        <article class="item">
          <p class="item-title">${item.title}</p>
          <p class="item-sub">${item.uid}</p>
          ${stats}
        </article>
      `;
    })
    .join('');
}

function renderRecommended(container, list) {
  if (!Array.isArray(list) || list.length === 0) {
    setEmpty(container);
    return;
  }

  container.innerHTML = list
    .map((item) => `
      <article class="item">
        <p class="item-title">${item.title}</p>
        <p class="item-sub">by: ${(item.recommenders || []).join(', ') || 'unknown'}</p>
        <span class="badge">x${item.recommendCount || 0}</span>
      </article>
    `)
    .join('');
}

function renderFriends(container, list) {
  if (!Array.isArray(list) || list.length === 0) {
    setEmpty(container);
    return;
  }

  container.innerHTML = list
    .map((friend) => `
      <article class="item">
        <p class="item-title">${friend.label}</p>
        <p class="item-sub">tg: ${friend.telegramId}</p>
      </article>
    `)
    .join('');
}

async function fetchDashboardSecurely() {
  const initData = getInitData();
  if (initData) {
    const response = await fetch('/api/webapp/dashboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ initData })
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message = errorPayload?.error || 'Telegram validation failed';
      throw new Error(message);
    }

    return response.json();
  }

  const debugUserId = getDebugUserId();
  if (!debugUserId) {
    throw new Error(tr(currentLang, 'errNoInitData'));
  }

  els.userMeta.textContent = tr(currentLang, 'debugMode', { id: debugUserId });
  const response = await fetch(`/api/dashboard/${encodeURIComponent(debugUserId)}`);
  if (!response.ok) {
    throw new Error(tr(currentLang, 'errUserNotFound'));
  }

  return response.json();
}

async function loadDashboard() {
  const data = await fetchDashboardSecurely();

  const userId = data.telegramUserId;
  const displayName = data.user?.username || data.user?.firstName || `#${userId}`;
  els.userMeta.textContent = tr(currentLang, 'profileMeta', { name: displayName, id: userId });

  els.watchedCount.textContent = String(data.watched?.length || 0);
  els.plannedCount.textContent = String(data.planned?.length || 0);
  els.favoritesCount.textContent = String(data.favorites?.length || 0);
  els.friendsCount.textContent = String(data.friends?.length || 0);

  renderAnimeList(els.watched, data.watched, true);
  renderAnimeList(els.planned, data.planned, false);
  renderAnimeList(els.favorites, data.favorites, false);
  renderRecommended(els.recommended, data.recommendedFromFriends);
  renderFriends(els.friends, data.friends);
}

for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => {
    for (const item of document.querySelectorAll('.tab-btn')) {
      item.classList.remove('active');
    }
    for (const panel of document.querySelectorAll('.tab-panel')) {
      panel.classList.remove('active');
    }

    btn.classList.add('active');
    const panel = document.getElementById(`tab-${btn.dataset.tab}`);
    if (panel) {
      panel.classList.add('active');
    }
  });
}

els.refreshBtn.addEventListener('click', () => {
  loadDashboard().catch((error) => {
    console.error(error);
    els.userMeta.textContent = error.message || tr(currentLang, 'errRefresh');
  });
});

if (els.langSelect) {
  els.langSelect.addEventListener('change', () => {
    applyLang(els.langSelect.value);
    loadDashboard().catch((error) => {
      console.error(error);
      els.userMeta.textContent = error.message || tr(currentLang, 'errLoad');
    });
  });
}

applyLang(currentLang);

loadDashboard().catch((error) => {
  console.error(error);
  els.userMeta.textContent = error.message || tr(currentLang, 'errLoad');
});

