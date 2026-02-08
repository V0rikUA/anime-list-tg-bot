'use client';

import { useEffect, useRef } from 'react';
import { Provider } from 'react-redux';
import { hydrate, makeStore } from './store';

export default function Providers({ children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  useEffect(() => {
    storeRef.current.dispatch(hydrate());
  }, []);

  return <Provider store={storeRef.current}>{children}</Provider>;
}

