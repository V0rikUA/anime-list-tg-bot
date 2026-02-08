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
  refreshBtn: document.getElementById('refreshBtn'),
  watched: document.getElementById('tab-watched'),
  planned: document.getElementById('tab-planned'),
  favorites: document.getElementById('tab-favorites'),
  recommended: document.getElementById('tab-recommended'),
  friends: document.getElementById('tab-friends')
};

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
  container.innerHTML = '<p class="empty">Empty</p>';
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
    throw new Error('No Telegram initData. Open app from bot or use ?debug=1&uid=<id>.');
  }

  els.userMeta.textContent = `Debug mode · User #${debugUserId}`;
  const response = await fetch(`/api/dashboard/${encodeURIComponent(debugUserId)}`);
  if (!response.ok) {
    throw new Error('User not found. Open bot and send /start first.');
  }

  return response.json();
}

async function loadDashboard() {
  const data = await fetchDashboardSecurely();

  const userId = data.telegramUserId;
  const displayName = data.user?.username || data.user?.firstName || `#${userId}`;
  els.userMeta.textContent = `@${displayName} · Telegram ID: ${userId}`;

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
    els.userMeta.textContent = error.message || 'Failed to refresh dashboard';
  });
});

loadDashboard().catch((error) => {
  console.error(error);
  els.userMeta.textContent = error.message || 'Failed to load dashboard';
});
