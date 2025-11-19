import React, { Suspense, lazy } from 'react';
import { usePandaBridge } from 'pandasuite-bridge-react';

import './App.css';

const SessionApp = lazy(() => import('./SessionApp'));
const AuthApp = lazy(() => import('./AuthApp'));

function App() {
  const { properties } = usePandaBridge() || {};
  const isSessionComponent = Boolean(properties && properties.apiKey);

  return (
    <Suspense fallback={null}>
      {isSessionComponent ? <SessionApp /> : <AuthApp />}
    </Suspense>
  );
}

export default App;
