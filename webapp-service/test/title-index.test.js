import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveTitleIndexPayload, extractRootTitle, normalizeTitleForIndex } from '../src/db.js';

test('normalizeTitleForIndex normalizes punctuation and spaces', () => {
  assert.equal(normalizeTitleForIndex('  Initial D: Second Stage!!!  '), 'initial d second stage');
});

test('extractRootTitle cuts known branch suffixes', () => {
  assert.equal(extractRootTitle('Initial D First Stage'), 'initial d');
  assert.equal(extractRootTitle('Гуррен-Лаганн: Спецвыпуск'), 'гуррен лаганн');
});

test('deriveTitleIndexPayload builds stable root key', () => {
  const payload = deriveTitleIndexPayload({ uid: 'mal:185', title: 'Initial D Second Stage', titleEn: 'Initial D Second Stage' });
  assert.equal(payload.rootKey, 'initial d');
  assert.equal(payload.branchTitleNormalized, 'initial d second stage');
});
