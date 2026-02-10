import test from 'node:test';
import assert from 'node:assert/strict';

import { score, rankCatalogResults } from '../src/ranking.js';

test('score priority: exact > prefix > substring > fuzzy', () => {
  const q = 'naruto';
  const exact = score(q, ['Naruto']);
  const prefix = score(q, ['Naruto Shippuden']);
  const substring = score(q, ['Best of Naruto moments']);
  const fuzzy = score(q, ['Nartuo']);

  assert.ok(exact > prefix);
  assert.ok(prefix > substring);
  assert.ok(substring > fuzzy);
});

test('score uses max across title variants', () => {
  const s = score('bleach', ['something', 'BLEACH', 'another']);
  assert.ok(s >= 1000);
});

test('deterministic tie-break: score then source priority then uid', () => {
  const items = [
    { uid: 'jikan:2', source: 'jikan', title: 'One Piece' },
    { uid: 'shikimori:1', source: 'shikimori', title: 'One Piece' },
    { uid: 'jikan:1', source: 'jikan', title: 'One Piece' }
  ];
  const ranked = rankCatalogResults('one piece', items);
  assert.equal(ranked[0].uid, 'shikimori:1'); // shikimori priority above jikan
  assert.equal(ranked[1].uid, 'jikan:1'); // uid asc within same source
  assert.equal(ranked[2].uid, 'jikan:2');
});
