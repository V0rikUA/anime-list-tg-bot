import test from 'node:test';
import assert from 'node:assert/strict';

import { ListRepository } from '../src/repository.js';

function normalizeTableName(raw) {
  return String(raw || '').split(/\s+/)[0];
}

function pickFields(row, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return { ...row };
  const out = {};
  for (const f of fields) out[f] = row[f];
  return out;
}

function createDbMock({ users = [], anime = [], progress = [] } = {}) {
  const state = {
    users: users.map((u) => ({ ...u })),
    anime: anime.map((a) => ({ ...a })),
    user_watch_progress: progress.map((p) => ({ ...p }))
  };
  const ids = {
    users: state.users.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    user_watch_progress: state.user_watch_progress.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  };

  let nowTick = 0;
  const nextNow = () => {
    nowTick += 1;
    return new Date(1700000000000 + nowTick * 1000).toISOString();
  };

  class QueryBuilder {
    constructor(tableRaw) {
      this.table = normalizeTableName(tableRaw);
      this.wherePayload = null;
      this.whereInPayload = null;
      this.orderPayload = null;
      this.limitValue = null;
    }

    where(payload) {
      this.wherePayload = payload ? { ...payload } : null;
      return this;
    }

    whereIn(field, values) {
      this.whereInPayload = { field: String(field), values: new Set(values || []) };
      return this;
    }

    orderBy(field, direction = 'asc') {
      this.orderPayload = { field: String(field), direction: String(direction || 'asc').toLowerCase() };
      return this;
    }

    limit(value) {
      this.limitValue = Number(value);
      return this;
    }

    select(...fields) {
      const rows = this._rows().map((row) => pickFields(row, fields));
      return Promise.resolve(rows);
    }

    first() {
      const rows = this._rows();
      return Promise.resolve(rows[0] ? { ...rows[0] } : undefined);
    }

    insert(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const raw of rows) {
        const row = { ...raw };
        if (this.table === 'users' && (row.id === undefined || row.id === null)) {
          row.id = ids.users++;
        }
        if (this.table === 'user_watch_progress' && (row.id === undefined || row.id === null)) {
          row.id = ids.user_watch_progress++;
        }
        state[this.table].push(row);
      }
      return Promise.resolve(rows);
    }

    update(payload) {
      const matches = this._rowsRef();
      for (const row of matches) {
        Object.assign(row, payload);
      }
      return Promise.resolve(matches.length);
    }

    del() {
      const matches = this._rowsRef();
      let deleted = 0;
      state[this.table] = state[this.table].filter((row) => {
        if (matches.includes(row)) {
          deleted += 1;
          return false;
        }
        return true;
      });
      return Promise.resolve(deleted);
    }

    _rowsRef() {
      let rows = state[this.table];
      if (!Array.isArray(rows)) {
        throw new Error(`unknown table: ${this.table}`);
      }

      if (this.wherePayload) {
        rows = rows.filter((row) => Object.entries(this.wherePayload).every(([k, v]) => row[k] === v));
      }
      if (this.whereInPayload) {
        rows = rows.filter((row) => this.whereInPayload.values.has(row[this.whereInPayload.field]));
      }
      if (this.orderPayload) {
        const { field, direction } = this.orderPayload;
        rows = [...rows].sort((a, b) => {
          const av = a[field];
          const bv = b[field];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          return direction === 'desc' ? (String(bv).localeCompare(String(av))) : (String(av).localeCompare(String(bv)));
        });
      }
      if (Number.isFinite(this.limitValue) && this.limitValue >= 0) {
        rows = rows.slice(0, this.limitValue);
      }
      return rows;
    }

    _rows() {
      return this._rowsRef().map((row) => ({ ...row }));
    }
  }

  const db = (tableRaw) => new QueryBuilder(tableRaw);
  db.__state = state;
  db.fn = { now: nextNow };
  db.schema = {
    async hasTable() {
      return false;
    }
  };
  db.transaction = async (fn) => fn(db);
  return db;
}

class TestListRepository extends ListRepository {
  async _ensureUserByTelegramId(db, telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');
    let user = db.__state.users.find((u) => String(u.telegram_id) === telegramId);
    if (!user) {
      const now = db.fn.now();
      user = {
        id: db.__state.users.length + 1,
        telegram_id: telegramId,
        updated_at: now
      };
      db.__state.users.push(user);
    }
    return { ...user };
  }
}

test('upsertWatchProgress updates existing row instead of inserting duplicates', async () => {
  const db = createDbMock({
    anime: [{ uid: 'mal:185', title: 'Initial D', title_en: 'Initial D' }]
  });
  const repo = new TestListRepository(db);

  await repo.upsertWatchProgress('100', {
    animeUid: 'mal:185',
    episodeLabel: '1',
    startedVia: 'webapp_quality',
    source: 'animego'
  });
  await repo.upsertWatchProgress('100', {
    animeUid: 'mal:185',
    episodeLabel: '2',
    episodeNumber: 2,
    startedVia: 'webapp_quality',
    quality: '1080'
  });

  assert.equal(db.__state.user_watch_progress.length, 1);
  assert.equal(db.__state.user_watch_progress[0].last_episode, '2');
  assert.equal(Number(db.__state.user_watch_progress[0].last_episode_number), 2);
  assert.equal(db.__state.user_watch_progress[0].started_via, 'webapp_quality');
});

test('getRecentWatchProgress returns 5 latest items and isolates users', async () => {
  const anime = Array.from({ length: 6 }, (_, idx) => ({
    uid: `mal:${idx + 1}`,
    title: `Title ${idx + 1}`,
    title_en: `Title ${idx + 1}`
  }));
  const db = createDbMock({ anime });
  const repo = new TestListRepository(db);

  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await repo.upsertWatchProgress('42', {
      animeUid: `mal:${i + 1}`,
      episodeLabel: String(i + 1),
      startedVia: 'webapp_quality'
    });
  }
  await repo.upsertWatchProgress('99', {
    animeUid: 'mal:1',
    episodeLabel: '99',
    startedVia: 'bot_source'
  });

  const out = await repo.getRecentWatchProgress('42', { limit: 5, lang: 'en' });
  assert.equal(out.user.telegramId, '42');
  assert.equal(out.items.length, 5);
  assert.equal(out.items[0].uid, 'mal:6');
  assert.equal(out.items[0].lastEpisode, '6');
  assert.ok(out.items.every((item) => item.uid !== 'mal:1' || item.lastEpisode !== '99'));
});

test('deleteWatchProgress removes only the requested canonical uid row', async () => {
  const db = createDbMock({
    users: [{ id: 1, telegram_id: '7' }],
    anime: [{ uid: 'mal:10', title: 'A' }, { uid: 'mal:11', title: 'B' }],
    progress: [
      { id: 1, user_id: 1, anime_uid: 'mal:10', last_episode: '3', started_via: 'webapp_quality' },
      { id: 2, user_id: 1, anime_uid: 'mal:11', last_episode: '2', started_via: 'bot_source' }
    ]
  });
  const repo = new TestListRepository(db);

  const res = await repo.deleteWatchProgress('7', 'mal:10');
  assert.equal(res.ok, true);
  assert.equal(res.deleted, true);
  assert.equal(db.__state.user_watch_progress.length, 1);
  assert.equal(db.__state.user_watch_progress[0].anime_uid, 'mal:11');
});
