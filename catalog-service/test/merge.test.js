import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeCatalogResults } from '../src/merge.js';

test('merges jikan+shikimori into one canonical MAL record', () => {
  const items = [
    {
      uid: 'jikan:185',
      source: 'jikan',
      externalId: 185,
      title: 'Initial D First Stage',
      titleEn: 'Initial D First Stage',
      synopsisEn: 'Street racing anime.',
      score: 8.36,
      episodes: 26,
      url: 'https://myanimelist.net/anime/185/Initial_D_First_Stage'
    },
    {
      uid: 'shikimori:185',
      source: 'shikimori',
      externalId: 185,
      title: 'Инициал Ди: Первая стадия',
      titleRu: 'Инициал Ди: Первая стадия',
      synopsisRu: 'Аниме о уличных гонках.',
      score: 8.36,
      episodes: 26,
      url: 'https://shikimori.one/animes/185'
    }
  ];

  const merged = mergeCatalogResults(items);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].uid, 'mal:185');
  assert.equal(merged[0].titleRu, 'Инициал Ди: Первая стадия');
  assert.equal(merged[0].titleEn, 'Initial D First Stage');
  assert.equal(merged[0].synopsisRu, 'Аниме о уличных гонках.');
  assert.equal(merged[0].synopsisEn, 'Street racing anime.');
  assert.deepEqual(merged[0].legacyUids, ['shikimori:185', 'jikan:185']);
  assert.equal(merged[0].sourceRefs.shikimori.externalId, 185);
  assert.equal(merged[0].sourceRefs.jikan.externalId, 185);
});

test('deterministic sourceRefs and legacy UID order', () => {
  const items = [
    { uid: 'jikan:2', source: 'jikan', externalId: 2, title: 'One Piece' },
    { uid: 'shikimori:2', source: 'shikimori', externalId: 2, title: 'One Piece' },
    { uid: 'jikan:2', source: 'jikan', externalId: 2, title: 'One Piece' }
  ];

  const a = mergeCatalogResults(items);
  const b = mergeCatalogResults([...items].reverse());

  assert.deepEqual(a[0].legacyUids, ['shikimori:2', 'jikan:2']);
  assert.deepEqual(b[0].legacyUids, ['shikimori:2', 'jikan:2']);
  assert.deepEqual(Object.keys(a[0].sourceRefs), Object.keys(b[0].sourceRefs));
});

test('does not merge items without MAL-compatible key', () => {
  const items = [
    { uid: 'anilist:100', source: 'anilist', externalId: 100, title: 'Foo' },
    { uid: 'anilist:101', source: 'anilist', externalId: 101, title: 'Foo 2' }
  ];

  const merged = mergeCatalogResults(items);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].uid, 'anilist:100');
  assert.equal(merged[1].uid, 'anilist:101');
});

