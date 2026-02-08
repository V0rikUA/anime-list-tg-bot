'use client';

import { useEffect, useRef } from 'react';
import { Provider } from 'react-redux';
import { hydrate, hydrateTheme, makeStore } from './store';
import ThemeSync from './ThemeSync';

export default function Providers({ children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  useEffect(() => {
    storeRef.current.dispatch(hydrate());
    storeRef.current.dispatch(hydrateTheme());
  }, []);

  return (
    <Provider store={storeRef.current}>
      <ThemeSync />
      {children}
    </Provider>
  );
}
