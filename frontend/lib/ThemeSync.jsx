'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

function getOsScheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function getTelegramScheme() {
  try {
    const tg = window.Telegram?.WebApp;
    const scheme = String(tg?.colorScheme || '').toLowerCase();
    if (scheme === 'dark') return 'dark';
    if (scheme === 'light') return 'light';
  } catch {
    // ignore
  }
  return '';
}

/**
 * Applies effective theme to the document for global CSS variables:
 * - `html[data-theme="dark"|"light"]`
 * - `color-scheme` for form controls
 *
 * Uses Telegram `colorScheme` when available. In `auto` mode:
 * Telegram -> OS fallback.
 */
export default function ThemeSync() {
  const themePref = useSelector((s) => s.theme?.current || 'auto');
  const [telegramScheme, setTelegramScheme] = useState('');

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    setTelegramScheme(getTelegramScheme());

    if (tg?.onEvent && tg?.offEvent) {
      const handler = () => setTelegramScheme(getTelegramScheme());
      tg.onEvent('themeChanged', handler);
      return () => tg.offEvent('themeChanged', handler);
    }
  }, []);

  const effective = useMemo(() => {
    if (themePref === 'light' || themePref === 'dark') return themePref;
    return telegramScheme || getOsScheme();
  }, [themePref, telegramScheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme = effective;
  }, [effective]);

  return null;
}

