'use client';

import { configureStore, createSlice } from '@reduxjs/toolkit';
import { normalizeLang } from './i18n';

/**
 * @typedef {'auto'|'light'|'dark'} Theme
 */

/**
 * @param {unknown} raw
 * @returns {Theme}
 */
function normalizeTheme(raw) {
  const v = String(raw || '').toLowerCase();
  if (v === 'light') return 'light';
  if (v === 'dark') return 'dark';
  return 'auto';
}

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

/**
 * Resolve theme preference:
 * 1) localStorage('theme') => auto|light|dark
 * 2) fallback to 'auto'
 *
 * Effective theme in auto mode is decided by Telegram / OS.
 *
 * @returns {Theme}
 */
function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem('theme');
    if (saved) return normalizeTheme(saved);
  } catch {
    // ignore
  }
  return 'auto';
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

const themeSlice = createSlice({
  name: 'theme',
  initialState: {
    current: 'auto',
    hydrated: false
  },
  reducers: {
    hydrateTheme(state) {
      state.current = getInitialTheme();
      state.hydrated = true;
    },
    setTheme(state, action) {
      state.current = normalizeTheme(action.payload);
      state.hydrated = true;
      try {
        window.localStorage.setItem('theme', state.current);
      } catch {
        // ignore
      }
    }
  }
});

export const { hydrate, setLanguage } = languageSlice.actions;
export const { hydrateTheme, setTheme } = themeSlice.actions;

/**
 * Create a new Redux store instance.
 * Must be created per request (Next.js) and memoized on client.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      language: languageSlice.reducer,
      theme: themeSlice.reducer
    }
  });
}
