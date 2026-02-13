import test from 'node:test';
import assert from 'node:assert/strict';

import { translateText } from '../src/services/translate.js';

test('translateText uses explicit source language', async () => {
  const originalFetch = global.fetch;
  try {
    const calls = [];
    global.fetch = async (url) => {
      const u = new URL(String(url));
      calls.push({
        sl: u.searchParams.get('sl'),
        tl: u.searchParams.get('tl')
      });
      return {
        ok: true,
        async json() {
          return [[['Переклад', '']]];
        }
      };
    };

    const out = await translateText('Наруто', { from: 'ru', to: 'uk' });
    assert.equal(out, 'Переклад');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sl, 'ru');
    assert.equal(calls[0].tl, 'uk');
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateText falls back to source text on errors', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error('network');
    };
    const out = await translateText('Bleach', { from: 'en', to: 'uk' });
    assert.equal(out, 'Bleach');
  } finally {
    global.fetch = originalFetch;
  }
});

