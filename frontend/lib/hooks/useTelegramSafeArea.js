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
      // Telegram WebApp exposes two inset sources:
      // - safeAreaInset: OS notch/home indicator safe area
      // - contentSafeAreaInset: extra insets Telegram reserves for its own UI (notably on iOS)
      const safeTop = Number(tg?.safeAreaInset?.top || 0);
      const contentTop = Number(tg?.contentSafeAreaInset?.top || 0);
      const top = Math.max(Number.isFinite(safeTop) ? safeTop : 0, Number.isFinite(contentTop) ? contentTop : 0);
      document.documentElement.style.setProperty('--tg-safe-area-top', `${top}px`);
    };

    applySafeArea();
    if (tg?.onEvent && tg?.offEvent) {
      tg.onEvent('viewportChanged', applySafeArea);
      return () => tg.offEvent('viewportChanged', applySafeArea);
    }
  }, []);
}
