'use client';

import { useEffect } from 'react';

/**
 * Applies Telegram safe area inset (top) to CSS variable `--tg-safe-area-top`.
 *
 * This prevents content from being overlapped by Telegram WebView UI (notably on iOS,
 * but Telegram can change insets on other platforms too).
 */
export function useTelegramSafeArea() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();

    const applySafeArea = () => {
      const top = Number(tg?.safeAreaInset?.top || 0);
      document.documentElement.style.setProperty('--tg-safe-area-top', `${Number.isFinite(top) ? top : 0}px`);
    };

    applySafeArea();
    if (tg?.onEvent && tg?.offEvent) {
      tg.onEvent('viewportChanged', applySafeArea);
      return () => tg.offEvent('viewportChanged', applySafeArea);
    }
  }, []);
}
