'use client';

import { useEffect } from 'react';

function injectClarity(projectId) {
  if (!projectId) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.clarity) return;

  window.clarity = function clarity() {
    // eslint-disable-next-line prefer-rest-params
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
  script.setAttribute('data-clarity', 'true');
  document.head.appendChild(script);
}

export default function ClarityInit() {
  useEffect(() => {
    let cancelled = false;

    fetch('/api/analytics/clarity', { method: 'GET', cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const projectId = String(json?.projectId || '').trim();
        if (!projectId) return;
        injectClarity(projectId);
      })
      .catch(() => {
        // noop: analytics should never break app flow
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
