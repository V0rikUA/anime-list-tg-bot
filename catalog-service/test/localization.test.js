import test from 'node:test';
import assert from 'node:assert/strict';

import { localizeUk } from '../src/merge.js';

test('localizeUk prefers RU->UK for title and synopsis', async () => {
  const originalFetch = global.fetch;
  try {
    const seen = [];
    global.fetch = async (url) => {
      const u = new URL(String(url));
      seen.push({
        sl: u.searchParams.get('sl'),
        tl: u.searchParams.get('tl'),
        q: u.searchParams.get('q')
      });
      return {
        ok: true,
        async json() {
          return [[['Переклад', '']]];
        }
      };
    };

    const input = [{
      uid: 'mal:1',
      titleRu: 'Наруто',
      titleEn: 'Naruto',
      synopsisRu: 'Описание на русском',
      synopsisEn: 'English synopsis'
    }];

    const out = await localizeUk(input);
    assert.equal(out[0].titleUk, 'Переклад');
    assert.equal(out[0].synopsisUk, 'Переклад');
    assert.equal(seen.length, 2);
    assert.ok(seen.every((x) => x.sl === 'ru' && x.tl === 'uk'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('localizeUk falls back to EN->UK when RU is absent', async () => {
  const originalFetch = global.fetch;
  try {
    const seen = [];
    global.fetch = async (url) => {
      const u = new URL(String(url));
      seen.push({
        sl: u.searchParams.get('sl'),
        tl: u.searchParams.get('tl'),
        q: u.searchParams.get('q')
      });
      return {
        ok: true,
        async json() {
          return [[['Translated', '']]];
        }
      };
    };

    const input = [{
      uid: 'mal:2',
      titleEn: 'One Piece',
      synopsisEn: 'Pirates'
    }];

    const out = await localizeUk(input);
    assert.equal(out[0].titleUk, 'Translated');
    assert.equal(out[0].synopsisUk, 'Translated');
    assert.equal(seen.length, 2);
    assert.ok(seen.every((x) => x.sl === 'en' && x.tl === 'uk'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('localizeUk falls back to source text when translation fails', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error('network');
    };

    const input = [{
      uid: 'mal:3',
      titleRu: 'Блич',
      synopsisRu: 'Сюжет'
    }];

    const out = await localizeUk(input);
    assert.equal(out[0].titleUk, 'Блич');
    assert.equal(out[0].synopsisUk, 'Сюжет');
  } finally {
    global.fetch = originalFetch;
  }
});
