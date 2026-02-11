import test from 'node:test';
import assert from 'node:assert/strict';

import { ListRepository } from '../src/repository.js';

function createDbMock({ hasAliasTable = true, aliases = {} } = {}) {
  const db = (table) => {
    if (table !== 'anime_uid_aliases') {
      throw new Error(`unexpected table ${table}`);
    }

    const state = {
      aliasUid: null
    };

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

  return db;
}

test('resolveCanonicalUid maps legacy uid to canonical MAL uid', async () => {
  const db = createDbMock({
    hasAliasTable: true,
    aliases: {
      'jikan:185': 'mal:185'
    }
  });
  const repo = new ListRepository(db);
  const resolved = await repo.resolveCanonicalUid('jikan:185');
  assert.equal(resolved, 'mal:185');
});

test('resolveCanonicalUid falls back to input when alias table is absent', async () => {
  const db = createDbMock({ hasAliasTable: false });
  const repo = new ListRepository(db);
  const resolved = await repo.resolveCanonicalUid('shikimori:185');
  assert.equal(resolved, 'shikimori:185');
});

