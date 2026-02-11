import test from 'node:test';
import assert from 'node:assert/strict';

import { AnimeRepository } from '../src/db.js';

function createDbMock({ hasAliasTable = true, aliases = {} } = {}) {
  const db = (table) => {
    if (table !== 'anime_uid_aliases') {
      throw new Error(`unexpected table ${table}`);
    }
    const state = { aliasUid: '' };
    return {
      where(payload) {
        state.aliasUid = String(payload?.alias_uid || '');
        return this;
      },
      select() {
        return this;
      },
      async first() {
        const canonical = aliases[state.aliasUid];
        return canonical ? { canonical_uid: canonical } : null;
      }
    };
  };
  db.schema = {
    async hasTable(name) {
      return name === 'anime_uid_aliases' ? hasAliasTable : false;
    }
  };
  db.fn = { now: () => new Date() };
  db.raw = (x) => x;
  return db;
}

test('resolveCanonicalUid maps old source UID to canonical MAL UID', async () => {
  const repo = Object.create(AnimeRepository.prototype);
  repo.db = createDbMock({
    hasAliasTable: true,
    aliases: { 'shikimori:185': 'mal:185' }
  });
  repo._hasAliasTable = null;

  const resolved = await repo.resolveCanonicalUid('shikimori:185');
  assert.equal(resolved, 'mal:185');
});

test('resolveCanonicalUid keeps UID when alias table missing', async () => {
  const repo = Object.create(AnimeRepository.prototype);
  repo.db = createDbMock({ hasAliasTable: false });
  repo._hasAliasTable = null;

  const resolved = await repo.resolveCanonicalUid('jikan:185');
  assert.equal(resolved, 'jikan:185');
});

