'use client';

import { configureStore, createSlice } from '@reduxjs/toolkit';
import { normalizeLang } from './i18n';

/**
 * Read user's language from Telegram initData (if available).
 * Client-only helper.
 *
 * @returns {string}
 */
function getTelegramLang() {
  try {
    const tg = window.Telegram?.WebApp;
    return tg?.initDataUnsafe?.user?.language_code || '';
  } catch {
    return '';
  }
}

/**
 * Resolve initial UI language:
 * 1) localStorage('lang')
 * 2) Telegram user.language_code
 * 3) fallback to 'en'
 *
 * @returns {import('./i18n').Lang}
 */
function getInitialLang() {
  try {
    const saved = window.localStorage.getItem('lang');
    if (saved) return normalizeLang(saved);
  } catch {
    // ignore
  }

  return normalizeLang(getTelegramLang());
}

const languageSlice = createSlice({
  name: 'language',
  initialState: {
    current: 'en',
    hydrated: false
  },
  reducers: {
    hydrate(state) {
      state.current = getInitialLang();
      state.hydrated = true;
    },
    setLanguage(state, action) {
      state.current = normalizeLang(action.payload);
      state.hydrated = true;
      try {
        window.localStorage.setItem('lang', state.current);
      } catch {
        // ignore
      }
    }
  }
});

export const { hydrate, setLanguage } = languageSlice.actions;

/**
 * Create a new Redux store instance.
 * Must be created per request (Next.js) and memoized on client.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      language: languageSlice.reducer
    }
  });
}
